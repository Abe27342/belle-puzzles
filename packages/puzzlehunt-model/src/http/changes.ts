import type { HuntScope } from '../document.js';
import type { PuzzlehuntModel } from '../model/puzzlehunt.js';
import {
	decodeHuntRevisionNotification,
	HuntHttpError,
	HuntProtocolError,
} from './protocol.js';

export interface HuntChangeSubscription {
	/** Completes on close or a terminal scope/protocol failure. */
	readonly done: Promise<void>;
	close(): void;
	/** Also resumes a subscription paused for renewed credentials. */
	reconnect(): void;
}

export interface HuntChangeWatchOptions {
	readonly onRevision: (revision: number) => void;
	readonly onError: (error: unknown) => void;
	readonly signal?: AbortSignal;
}

export interface HuntModelWatchOptions {
	readonly onError: (error: unknown) => void;
	readonly signal?: AbortSignal;
}

/** Credential-provider failure pauses observations, without classifying any pending write. */
export class HuntWatchCredentialError extends Error {
	constructor(cause: unknown) {
		super('A current puzzlehunt subscription credential is required.', {
			cause,
		});
		this.name = 'HuntWatchCredentialError';
	}
}

function abortable<Value>(
	pending: Promise<Value>,
	signal: AbortSignal
): Promise<Value> {
	return new Promise((resolve, reject) => {
		const abort = () => {
			signal.removeEventListener('abort', abort);
			reject(signal.reason);
		};
		signal.addEventListener('abort', abort, { once: true });
		pending.then(
			(value) => {
				signal.removeEventListener('abort', abort);
				resolve(value);
			},
			(error) => {
				signal.removeEventListener('abort', abort);
				reject(error);
			}
		);
		if (signal.aborted) abort();
	});
}

/** SSE line framing is independent of chunk boundaries, including split CRLF and UTF-8. */
export async function* readHuntRevisionStream(
	body: ReadableStream<Uint8Array>,
	huntId: string,
	signal: AbortSignal,
	activity: () => void
): AsyncGenerator<number> {
	const reader = body.getReader();
	const decoder = new TextDecoder('utf-8', { fatal: true });
	let line = '';
	let data = '';
	let event = '';
	let skipLF = false;
	let eventSize = 0;
	try {
		signal.throwIfAborted();
		while (true) {
			const chunk = await abortable(reader.read(), signal);
			signal.throwIfAborted();
			if (chunk.done) break;
			activity();
			let text: string;
			try {
				text = decoder.decode(chunk.value, { stream: true });
			} catch (error) {
				throw new HuntProtocolError(
					'Invalid UTF-8 in the hunt change stream.',
					{ cause: error }
				);
			}
			for (const char of text) {
				if (skipLF && char === '\n') {
					skipLF = false;
					continue;
				}
				skipLF = false;
				if (char !== '\r' && char !== '\n') {
					line += char;
					if (++eventSize > 65536) {
						throw new HuntProtocolError(
							'Hunt change stream event exceeded its size limit.'
						);
					}
					continue;
				}
				skipLF = char === '\r';
				if (line === '') {
					if (event === 'revision' && data !== '') {
						let value: unknown;
						try {
							value = JSON.parse(data);
						} catch (error) {
							throw new HuntProtocolError(
								'Invalid JSON in a hunt revision event.',
								{ cause: error }
							);
						}
						yield decodeHuntRevisionNotification(value, huntId);
					}
					event = data = '';
					eventSize = 0;
				} else if (!line.startsWith(':')) {
					const colon = line.indexOf(':');
					const field = colon < 0 ? line : line.slice(0, colon);
					const value =
						colon < 0
							? ''
							: line.slice(colon + 1).replace(/^ /, '');
					if (field === 'event') event = value;
					if (field === 'data') data += `${value}\n`;
				}
				line = '';
			}
		}
	} finally {
		try {
			await reader.cancel();
		} finally {
			reader.releaseLock();
		}
	}
}

/** Fetch streaming supports Authorization headers; stream hints never retry commands. */
export function watchHuntChanges(
	scope: HuntScope,
	request: (signal: AbortSignal) => Promise<Response>,
	options: HuntChangeWatchOptions
): HuntChangeSubscription {
	let stopped = false;
	let attempt: AbortController | undefined;
	let wake: (() => void) | undefined;
	let retryMs = 1000;
	let restartRequested = false;
	const close = () => {
		stopped = true;
		attempt?.abort();
		wake?.();
	};
	const reconnect = () => {
		restartRequested = true;
		attempt?.abort();
		wake?.();
	};
	const wait = (delay?: number) =>
		new Promise<void>((resolve) => {
			let timer: ReturnType<typeof setTimeout> | undefined;
			const finish = () => {
				clearTimeout(timer);
				wake = undefined;
				resolve();
			};
			wake = finish;
			if (stopped) finish();
			else if (delay !== undefined) timer = setTimeout(finish, delay);
		});
	options.signal?.addEventListener('abort', close, { once: true });
	if (options.signal?.aborted) close();
	const done = (async () => {
		try {
			while (!stopped) {
				restartRequested = false;
				attempt = new AbortController();
				const controller = attempt;
				let watchdog: ReturnType<typeof setTimeout> | undefined;
				let paused = false;
				let terminal = false;
				let timedOut = false;
				let retryAfterMs = 0;
				const activity = () => {
					clearTimeout(watchdog);
					watchdog = setTimeout(() => {
						timedOut = true;
						controller.abort(
							new Error('Puzzlehunt change stream timed out.')
						);
					}, 45000);
				};
				try {
					activity();
					const response = await abortable(
						request(controller.signal),
						controller.signal
					);
					if (response.status !== 200) {
						await response.body?.cancel();
						const error = new HuntHttpError(response.status);
						paused = response.status === 401;
						terminal =
							!paused &&
							response.status !== 429 &&
							response.status < 500;
						const retryAfter = response.headers.get('retry-after');
						if (retryAfter !== null) {
							const delay = /^[0-9]+$/.test(retryAfter)
								? Number(retryAfter) * 1000
								: Date.parse(retryAfter) - Date.now();
							if (Number.isFinite(delay)) {
								retryAfterMs = Math.max(
									0,
									Math.min(2147483647, delay)
								);
							}
						}
						options.onError(error);
					} else {
						if (
							response.headers
								.get('content-type')
								?.split(';')[0]
								.trim()
								.toLowerCase() !== 'text/event-stream' ||
							!response.body
						) {
							await response.body?.cancel();
							throw new HuntProtocolError(
								'Expected a hunt SSE response.'
							);
						}
						for await (const revision of readHuntRevisionStream(
							response.body,
							scope.huntId,
							controller.signal,
							activity
						)) {
							retryMs = 1000;
							options.onRevision(revision);
						}
					}
				} catch (error) {
					if (!stopped && (!controller.signal.aborted || timedOut)) {
						paused = error instanceof HuntWatchCredentialError;
						terminal = error instanceof HuntProtocolError;
						options.onError(error);
					}
				} finally {
					clearTimeout(watchdog);
					controller.abort();
					attempt = undefined;
				}
				if (stopped || terminal) break;
				if (restartRequested) continue;
				await wait(
					paused
						? undefined
						: Math.max(
								retryAfterMs,
								Math.min(
									30000,
									retryMs * (0.75 + Math.random() * 0.5)
								)
						  )
				);
				retryMs = Math.min(30000, retryMs * 2);
			}
		} finally {
			options.signal?.removeEventListener('abort', close);
		}
	})();
	return { done, close, reconnect };
}

/** At most one catch-up is queued, even while the model is paused on an uncertain write. */
export function watchPuzzlehuntModel(
	client: {
		watch(
			scope: HuntScope,
			options: HuntChangeWatchOptions
		): HuntChangeSubscription;
	},
	model: PuzzlehuntModel,
	options: HuntModelWatchOptions
): HuntChangeSubscription {
	let target = model.committedSnapshot.revision;
	let refreshing = false;
	let closed = false;
	let authorized = true;
	const catchUp = (force = false) => {
		if (
			closed ||
			refreshing ||
			!authorized ||
			model.pendingChanges[0]?.status === 'uncertain' ||
			(!force && target <= model.committedSnapshot.revision)
		)
			return;
		refreshing = true;
		void model.refresh(force ? undefined : target).then(
			() => {
				refreshing = false;
				catchUp();
			},
			(error) => {
				refreshing = false;
				options.onError(error);
			}
		);
	};
	const unsubscribe = model.subscribe(() => catchUp());
	const stream = client.watch(model.committedSnapshot, {
		signal: options.signal,
		onRevision: (revision) => {
			authorized = true;
			target = Math.max(target, revision);
			catchUp();
		},
		onError: (error) => {
			if (
				error instanceof HuntWatchCredentialError ||
				error instanceof HuntProtocolError ||
				(error instanceof HuntHttpError &&
					[401, 403, 404].includes(error.status))
			) {
				authorized = false;
			}
			options.onError(error);
		},
	});
	const visible = () =>
		typeof document === 'undefined' ||
		document.visibilityState !== 'hidden';
	const recover = () => {
		if (visible()) catchUp(true);
	};
	const safety = setInterval(recover, 60000);
	if (typeof window !== 'undefined') {
		window.addEventListener('focus', recover);
		window.addEventListener('online', recover);
		document.addEventListener('visibilitychange', recover);
	}
	const close = () => {
		if (closed) return;
		closed = true;
		clearInterval(safety);
		unsubscribe();
		stream.close();
		options.signal?.removeEventListener('abort', close);
		if (typeof window !== 'undefined') {
			window.removeEventListener('focus', recover);
			window.removeEventListener('online', recover);
			document.removeEventListener('visibilitychange', recover);
		}
	};
	options.signal?.addEventListener('abort', close, { once: true });
	if (options.signal?.aborted) close();
	const done = stream.done.finally(close);
	return { done, close, reconnect: stream.reconnect };
}

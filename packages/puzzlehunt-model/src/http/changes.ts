import type { HuntScope } from '../document.js';
import type { PuzzlehuntModel } from '../model/puzzlehunt.js';
import {
	decodeHuntRevisionNotification,
	HuntHttpError,
	HuntProtocolError,
} from './protocol.js';

/** Lifetime controls shared by revision observation and model synchronization. */
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

export interface HuntModelSyncOptions {
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

/**
 * SSE line framing is independent of chunk boundaries, including split CRLF and UTF-8.
 * Decodes bytes incrementally and buffers partial lines across chunks. Completed
 * lines populate event fields; a blank line ends the event. Complete `revision`
 * events are parsed as JSON, validated for the expected hunt, and yielded as numbers.
 * An event without its terminating blank line is ignored at EOF.
 *
 * @see https://html.spec.whatwg.org/multipage/server-sent-events.html#parsing-an-event-stream
 * @see https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation
 */
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
				// Treat CRLF as one line ending, even across chunks.
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
					// A blank line completes the event, including all of its data lines.
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

/**
 * Observes a hunt's server revision without reading or updating a model.
 * Calls onRevision with hints that authoritative state may need to be read, not
 * acknowledgements of commands. Owns stream parsing, inactivity detection and
 * reconnection; credential failures pause until reconnect, and terminal failures stop.
 * Fetch streaming supports Authorization headers; stream hints never retry commands.
 *
 * @param scope - Fixed guild and hunt identity to observe.
 * @param request - Opens an authenticated SSE response on each connection attempt,
 * supplying current credentials and honoring the provided abort signal.
 * @param options - Revision/error callbacks and optional cancellation.
 * @returns Lifetime controls for the stream and its reconnect loop, not model state.
 */
export function watchHuntChanges(
	scope: HuntScope,
	request: (signal: AbortSignal) => Promise<Response>,
	options: HuntChangeWatchOptions
): HuntChangeSubscription {
	async function observe(
		signal: AbortSignal,
		resetBackoff: () => void
	): Promise<RetryOutcome> {
		const stream = new AbortController();
		// A watchdog timeout ends the stream, not the cycle's retry backoff.
		const streamSignal = AbortSignal.any([signal, stream.signal]);
		let watchdog: ReturnType<typeof setTimeout> | undefined;
		let retryAfterMs = 0;
		const activity = () => {
			clearTimeout(watchdog);
			watchdog = setTimeout(
				() =>
					stream.abort(
						new Error('Puzzlehunt change stream timed out.')
					),
				45000
			);
		};
		try {
			activity();
			const response = await abortable(
				request(streamSignal),
				streamSignal
			);
			if (response.status !== 200) {
				await response.body?.cancel();
				const retryAfter = response.headers.get('retry-after');
				if (retryAfter !== null) {
					const delay = /^[0-9]+$/.test(retryAfter)
						? Number(retryAfter) * 1000
						: Date.parse(retryAfter) - Date.now();
					if (Number.isFinite(delay)) {
						retryAfterMs = Math.max(0, Math.min(2147483647, delay));
					}
				}
				throw new HuntHttpError(response.status);
			}
			if (
				response.headers
					.get('content-type')
					?.split(';')[0]
					.trim()
					.toLowerCase() !== 'text/event-stream' ||
				!response.body
			) {
				await response.body?.cancel();
				throw new HuntProtocolError('Expected a hunt SSE response.');
			}
			for await (const revision of readHuntRevisionStream(
				response.body,
				scope.huntId,
				streamSignal,
				activity
			)) {
				resetBackoff();
				options.onRevision(revision);
			}
			return { type: 'retry', minimumDelayMs: 0 };
		} catch (error) {
			signal.throwIfAborted();
			options.onError(error);
			if (
				error instanceof HuntWatchCredentialError ||
				(error instanceof HuntHttpError && error.status === 401)
			) {
				return { type: 'pause' };
			}
			if (error instanceof HuntHttpError) {
				if (error.status === 429 || error.status >= 500) {
					return { type: 'retry', minimumDelayMs: retryAfterMs };
				}
			} else if (!(error instanceof HuntProtocolError)) {
				return { type: 'retry', minimumDelayMs: retryAfterMs };
			}
			return { type: 'stop' };
		} finally {
			clearTimeout(watchdog);
			stream.abort();
		}
	}

	return runRetryLoop(observe, options.signal);
}

type RetryOutcome =
	| { type: 'retry'; minimumDelayMs: number }
	| { type: 'pause' | 'stop' };

/**
 * Runs sequential attempts with interruptible backoff or an indefinite pause.
 * Retries use jittered exponential backoff with a one-second initial base and a
 * 30-second cap, unless the outcome's minimumDelayMs requires a longer wait.
 * A pause waits for reconnect; a stop completes done. Non-cancellation exceptions
 * reject done instead of implicitly retrying.
 *
 * @param attempt - Performs one attempt and returns its retry, pause or stop policy.
 * Must honor its abort signal and settle after cleanup before another attempt starts.
 * Call resetBackoff after healthy progress to reset the next retry's base delay.
 * @param signal - Optional external cancellation that permanently closes the loop.
 * @returns Controls to close permanently or reconnect by aborting the current attempt
 * or wait, plus a promise that completes when the loop ends.
 */
function runRetryLoop(
	attempt: (
		signal: AbortSignal,
		resetBackoff: () => void
	) => Promise<RetryOutcome>,
	signal?: AbortSignal
): HuntChangeSubscription {
	let closed = false;
	let cycle = new AbortController();
	let retryMs = 1000;
	const resetBackoff = () => {
		retryMs = 1000;
	};
	const close = () => {
		closed = true;
		cycle.abort();
	};
	const reconnect = () => cycle.abort();
	const waitForAbort = (signal: AbortSignal) =>
		new Promise<void>((resolve) => {
			if (signal.aborted) resolve();
			else
				signal.addEventListener('abort', () => resolve(), {
					once: true,
				});
		});

	signal?.addEventListener('abort', close, { once: true });
	if (signal?.aborted) close();
	const done = (async () => {
		try {
			while (!closed) {
				const controller = (cycle = new AbortController());
				let retryTimer: ReturnType<typeof setTimeout> | undefined;
				try {
					const outcome = await attempt(
						controller.signal,
						resetBackoff
					);
					if (outcome.type === 'stop') break;
					controller.signal.throwIfAborted();
					if (outcome.type === 'retry') {
						const delay = Math.max(
							outcome.minimumDelayMs,
							Math.min(
								30000,
								retryMs * (0.75 + Math.random() * 0.5)
							)
						);
						retryTimer = setTimeout(
							() => controller.abort(),
							delay
						);
					}
					await waitForAbort(controller.signal);
					retryMs = Math.min(30000, retryMs * 2);
				} catch (error) {
					if (!controller.signal.aborted) throw error;
				} finally {
					clearTimeout(retryTimer);
					controller.abort();
				}
			}
		} finally {
			signal?.removeEventListener('abort', close);
		}
	})();
	return { done, close, reconnect };
}

/**
 * Starts continuous server-to-model synchronization for an existing model.
 * Uses one revision-hint subscription to request catch-up through the model's refresh
 * queue. Hints never acknowledge or automatically retry commands; catch-up waits
 * while an uncertain write blocks the model. At most one catch-up is queued.
 * Focus, connectivity, visibility and periodic recovery also request refreshes.
 *
 * @param watch - Opens the revision-hint subscription for the model's fixed hunt.
 * @param model - Existing model to refresh; active-hunt selection does not retarget it.
 * @param options - Error reporting and optional cancellation.
 * @returns Controls for synchronization lifetime, not initial catch-up completion.
 * Closing removes the stream, model subscription and recovery hooks without flushing
 * or disposing the model, or cancelling an already-running refresh.
 */
export function syncPuzzlehuntModel(
	watch: (
		scope: HuntScope,
		options: HuntChangeWatchOptions
	) => HuntChangeSubscription,
	model: PuzzlehuntModel,
	options: HuntModelSyncOptions
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
	const stream = watch(model.committedSnapshot, {
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

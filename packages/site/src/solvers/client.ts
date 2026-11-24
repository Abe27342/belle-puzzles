import moduleUrl from './solver.worker.ts?worker&url';
import type { SolverRequest, SolverResponse } from './protocol';
import { formatSolverError } from './errors';

export interface SolverClient {
	next(): void;
	dispose(): void;
}

export interface PreparedSolverWorker {
	start(
		puzzleType: string,
		text: string,
		onResponse: (response: SolverResponse) => void
	): SolverClient;
	dispose(): void;
}

export function prepareSolverWorker(): PreparedSolverWorker {
	if (
		!window.crossOriginIsolated ||
		typeof SharedArrayBuffer === 'undefined'
	) {
		throw new Error(
			'This solver requires a browser with cross-origin isolation and SharedArrayBuffer support.'
		);
	}
	const worker = new Worker('/solver-assets/bootstrap.js');
	let ready = false;
	let disposed = false;
	let closed = false;
	let puzzleType: string | undefined;
	let startRequest: Extract<SolverRequest, { type: 'start' }> | undefined;
	let onResponse: ((response: SolverResponse) => void) | undefined;
	let failed = false;
	let failure: unknown;
	const send = (request: SolverRequest) => worker.postMessage(request);
	const close = () => {
		closed = true;
		worker.terminate();
	};
	const dispose = () => {
		if (disposed || closed) return;
		disposed = true;
		// Terminating only the parent worker can leave Emscripten threads alive.
		if (ready) send({ type: 'dispose' });
	};
	const failWhileIdle = (error: unknown) => {
		failed = true;
		failure = error;
		console.error(error);
	};
	worker.onmessage = ({ data }: MessageEvent<SolverResponse>) => {
		if (data.type === 'ready') {
			ready = true;
			if (disposed) send({ type: 'dispose' });
			else if (startRequest) send(startRequest);
		} else if (data.type === 'disposed') {
			close();
		} else if (disposed) {
			if (data.type === 'error') {
				console.error(
					formatSolverError(
						data.message,
						data.stage ?? 'cleanup',
						puzzleType
					)
				);
				close();
			}
		} else if (onResponse) {
			onResponse(
				data.type === 'error'
					? {
							...data,
							message: formatSolverError(
								data.message,
								data.stage ?? (ready ? 'solve' : 'runtime'),
								puzzleType
							),
					  }
					: data
			);
			if (!ready && data.type === 'error') {
				close();
			}
		} else {
			failWhileIdle(
				new Error(
					data.type === 'error'
						? data.message || 'Solver initialization failed.'
						: 'The idle solver worker returned an unexpected response.'
				)
			);
			if (ready) dispose();
			else close();
		}
	};
	worker.onerror = (event) => {
		if (!disposed) {
			if (onResponse) {
				if (ready) {
					console.log(event.error ?? event);
				}
				onResponse({
					type: 'error',
					message: formatSolverError(
						event,
						ready ? 'solve' : 'runtime',
						puzzleType
					),
				});
			} else {
				failWhileIdle(event.error ?? event);
			}
		} else {
			console.error(
				'Solver worker failed during cleanup:',
				event.message
			);
		}
		close();
	};
	worker.postMessage({
		moduleUrl: new URL(moduleUrl, window.location.href).href,
	});
	return {
		start(type, text, callback) {
			if (failed) throw failure;
			if (startRequest || disposed || closed) {
				throw new Error('The solver worker is no longer available.');
			}
			puzzleType = type;
			onResponse = callback;
			startRequest = { type: 'start', puzzleType, text };
			if (ready) send(startRequest);
			return {
				next() {
					if (disposed || closed || !ready) {
						throw new Error(
							'The solver session is no longer available.'
						);
					}
					send({ type: 'next' });
				},
				dispose,
			};
		},
		dispose,
	};
}

export function createSolverClient(
	puzzleType: string,
	text: string,
	onResponse: (response: SolverResponse) => void
): SolverClient {
	return prepareSolverWorker().start(puzzleType, text, onResponse);
}

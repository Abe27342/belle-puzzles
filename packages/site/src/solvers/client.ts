import moduleUrl from './solver.worker.ts?worker&url';
import type { PuzzleType } from '@belle-puzzles/solver';
import type { SolverRequest, SolverResponse } from './protocol';
import { formatSolverError } from './errors';

export interface SolverClient {
	next(): void;
	dispose(): void;
}

export function createSolverClient(
	puzzleType: PuzzleType,
	text: string,
	onResponse: (response: SolverResponse) => void
): SolverClient {
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
	const send = (request: SolverRequest) => worker.postMessage(request);
	const close = () => {
		closed = true;
		worker.terminate();
	};
	worker.onmessage = ({ data }: MessageEvent<SolverResponse>) => {
		if (data.type === 'ready') {
			ready = true;
			send(
				disposed
					? { type: 'dispose' }
					: { type: 'start', puzzleType, text }
			);
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
		} else {
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
		}
	};
	worker.onerror = (event) => {
		if (!disposed) {
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
		next() {
			if (disposed || closed || !ready) {
				throw new Error('The solver session is no longer available.');
			}
			send({ type: 'next' });
		},
		dispose() {
			if (disposed || closed) return;
			disposed = true;
			// Terminating only the parent worker can leave Emscripten threads alive.
			if (ready) send({ type: 'dispose' });
		},
	};
}

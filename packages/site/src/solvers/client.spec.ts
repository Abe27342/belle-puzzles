import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createSolverClient, prepareSolverWorker } from './client';
import type { SolverResponse } from './protocol';

class FakeWorker {
	static current: FakeWorker;
	onmessage: (event: MessageEvent<SolverResponse>) => void;
	onerror: (event: ErrorEvent) => void;
	postMessage = vi.fn();
	terminate = vi.fn();
	constructor() {
		FakeWorker.current = this;
	}
	respond(data: SolverResponse) {
		this.onmessage(new MessageEvent('message', { data }));
	}
}

beforeEach(() => {
	vi.stubGlobal('Worker', FakeWorker);
	vi.stubGlobal('crossOriginIsolated', true);
});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

it('waits for initialization before starting, and terminates only after thread cleanup', () => {
	const callback = vi.fn();
	const client = createSolverClient('sudoku', 'text', callback);
	const worker = FakeWorker.current;
	expect(worker.postMessage).toHaveBeenCalledTimes(1);
	expect(worker.postMessage).toHaveBeenCalledWith({
		moduleUrl: expect.any(String),
		z3AssetBase: new URL(
			import.meta.env.VITE_Z3_ASSET_BASE,
			window.location.href
		).href,
	});
	worker.respond({ type: 'ready' });
	expect(worker.postMessage).toHaveBeenLastCalledWith({
		type: 'start',
		puzzleType: 'sudoku',
		text: 'text',
	});
	worker.respond({ type: 'solution', output: 'grid' });
	expect(callback).toHaveBeenCalledWith({ type: 'solution', output: 'grid' });
	client.next();
	expect(worker.postMessage).toHaveBeenLastCalledWith({ type: 'next' });
	client.dispose();
	expect(worker.postMessage).toHaveBeenLastCalledWith({ type: 'dispose' });
	expect(worker.terminate).not.toHaveBeenCalled();
	worker.respond({ type: 'solution', output: 'stale' });
	expect(callback).toHaveBeenCalledTimes(1);
	worker.respond({ type: 'disposed' });
	expect(worker.terminate).toHaveBeenCalledTimes(1);
	client.dispose();
	expect(() => client.next()).toThrow('no longer available');
});

it('cancels before initialization without starting a puzzle or abandoning its runtime', () => {
	const client = createSolverClient('masyu', 'text', vi.fn());
	const worker = FakeWorker.current;
	client.dispose();
	expect(worker.terminate).not.toHaveBeenCalled();
	worker.respond({ type: 'ready' });
	expect(worker.postMessage).toHaveBeenLastCalledWith({ type: 'dispose' });
	worker.respond({ type: 'disposed' });
	expect(worker.terminate).toHaveBeenCalledTimes(1);
});

it('surfaces initialization failure and closes the failed worker', () => {
	const callback = vi.fn();
	createSolverClient('cave', 'text', callback);
	const worker = FakeWorker.current;
	worker.respond({ type: 'error', message: 'Initialization failed' });
	expect(callback).toHaveBeenCalledWith({
		type: 'error',
		message: expect.stringContaining('Initialization failed'),
	});
	expect(worker.terminate).toHaveBeenCalledTimes(1);
});

it('adds puzzle-specific guidance to parsing failures', () => {
	const callback = vi.fn();
	createSolverClient('hashi', 'X', callback);
	const worker = FakeWorker.current;
	worker.respond({ type: 'ready' });
	worker.respond({
		type: 'error',
		stage: 'parse',
		message: 'Invalid digit at 0,0: "X"',
	});
	expect(callback).toHaveBeenCalledWith({
		type: 'error',
		stage: 'parse',
		message: expect.stringContaining('Could not parse this Hashi puzzle'),
	});
	expect(callback.mock.calls[0][0].message).toContain('Invalid digit at 0,0');
});

it('replaces raw worker events with reload guidance', () => {
	const callback = vi.fn();
	createSolverClient('hashi', '..1', callback);
	FakeWorker.current.onerror(
		new ErrorEvent('error', {
			message: 'Uncaught [object Event]',
			error: new Event('error'),
		})
	);
	expect(callback).toHaveBeenCalledWith({
		type: 'error',
		message: expect.stringContaining('Reload the page'),
	});
	expect(callback.mock.calls[0][0].message).not.toContain('[object');
	expect(FakeWorker.current.terminate).toHaveBeenCalledTimes(1);
});
it('rejects unsupported environments before creating a worker', () => {
	vi.stubGlobal('crossOriginIsolated', false);
	expect(() => createSolverClient('sudoku', 'text', vi.fn())).toThrow(
		'cross-origin isolation'
	);
});

it('logs the original post-initialization worker error and shows a brief solve failure', () => {
	const log = vi.spyOn(console, 'log').mockImplementation(() => {});
	const callback = vi.fn();
	createSolverClient('hashi', '2.2', callback);
	const worker = FakeWorker.current;
	worker.respond({ type: 'ready' });
	const error = new Error('Internal solver failure');
	worker.onerror(new ErrorEvent('error', { error, message: error.message }));
	expect(log).toHaveBeenCalledWith(error);
	expect(callback).toHaveBeenCalledWith({
		type: 'error',
		message: 'The solver could not finish this Hashi puzzle.',
	});
	expect(worker.terminate).toHaveBeenCalledTimes(1);
});

it('loads an idle worker without solving and starts the first puzzle on that same worker', () => {
	const prepared = prepareSolverWorker();
	const worker = FakeWorker.current;
	expect(worker.postMessage).toHaveBeenCalledTimes(1);
	worker.respond({ type: 'ready' });
	expect(worker.postMessage).toHaveBeenCalledTimes(1);
	const callback = vi.fn();
	const client = prepared.start('cave', 'example', callback);
	expect(FakeWorker.current).toBe(worker);
	expect(worker.postMessage).toHaveBeenLastCalledWith({
		type: 'start',
		puzzleType: 'cave',
		text: 'example',
	});
	expect(() => prepared.start('hashi', 'example', vi.fn())).toThrow(
		'no longer available'
	);
	worker.respond({ type: 'solution', output: 'grid' });
	expect(callback).toHaveBeenCalledWith({ type: 'solution', output: 'grid' });
	client.dispose();
	expect(worker.terminate).not.toHaveBeenCalled();
	worker.respond({ type: 'disposed' });
	expect(worker.terminate).toHaveBeenCalledTimes(1);
});

it('queues the first solve when the preloaded worker is still initializing', () => {
	const prepared = prepareSolverWorker();
	const worker = FakeWorker.current;
	prepared.start('masyu', 'example', vi.fn());
	expect(worker.postMessage).toHaveBeenCalledTimes(1);
	worker.respond({ type: 'ready' });
	expect(worker.postMessage).toHaveBeenLastCalledWith({
		type: 'start',
		puzzleType: 'masyu',
		text: 'example',
	});
});

it.each([false, true])(
	'cleans up an unused preloaded worker, ready=%s',
	(ready) => {
		const prepared = prepareSolverWorker();
		const worker = FakeWorker.current;
		if (ready) worker.respond({ type: 'ready' });
		prepared.dispose();
		expect(worker.terminate).not.toHaveBeenCalled();
		if (!ready) worker.respond({ type: 'ready' });
		expect(worker.postMessage).toHaveBeenLastCalledWith({
			type: 'dispose',
		});
		worker.respond({ type: 'disposed' });
		expect(worker.terminate).toHaveBeenCalledTimes(1);
		prepared.dispose();
		expect(worker.terminate).toHaveBeenCalledTimes(1);
	}
);

it('logs a preload failure and preserves it for the first solve attempt', () => {
	const log = vi.spyOn(console, 'error').mockImplementation(() => {});
	const prepared = prepareSolverWorker();
	const worker = FakeWorker.current;
	worker.respond({
		type: 'error',
		stage: 'runtime',
		message: 'Failed to load WASM',
	});
	expect(log).toHaveBeenCalledWith(
		expect.objectContaining({
			message: 'Failed to load WASM',
		})
	);
	expect(() => prepared.start('sudoku', 'example', vi.fn())).toThrow(
		'Failed to load WASM'
	);
	expect(worker.terminate).toHaveBeenCalledTimes(1);
});

it('logs and preserves the original browser error when an idle worker fails', () => {
	const log = vi.spyOn(console, 'error').mockImplementation(() => {});
	const prepared = prepareSolverWorker();
	const worker = FakeWorker.current;
	const error = new Error('Worker loading failed');
	worker.onerror(new ErrorEvent('error', { error }));
	expect(log).toHaveBeenCalledWith(error);
	expect(() => prepared.start('sudoku', 'example', vi.fn())).toThrow(error);
	expect(worker.terminate).toHaveBeenCalledTimes(1);
});

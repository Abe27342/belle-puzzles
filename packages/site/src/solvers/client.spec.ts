import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createSolverClient } from './client';
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
afterEach(() => vi.unstubAllGlobals());

it('waits for initialization before starting, and terminates only after thread cleanup', () => {
	const callback = vi.fn();
	const client = createSolverClient('sudoku', 'text', callback);
	const worker = FakeWorker.current;
	expect(worker.postMessage).toHaveBeenCalledTimes(1);
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
		message: 'Initialization failed',
	});
	expect(worker.terminate).toHaveBeenCalledTimes(1);
});

it('rejects unsupported environments before creating a worker', () => {
	vi.stubGlobal('crossOriginIsolated', false);
	expect(() => createSolverClient('sudoku', 'text', vi.fn())).toThrow(
		'cross-origin isolation'
	);
});

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SolverRequest } from './protocol';

const mocks = vi.hoisted(() => ({
	nextSolution: vi.fn(),
	render: vi.fn(),
}));

vi.mock('@belle-puzzles/solver', () => ({
	isPuzzleType: (type: string) => type === 'sudoku',
	puzzleTypes: {
		sudoku: {
			parser: {
				fromText: () => ({ grid: {}, renderOptions: {} }),
			},
		},
	},
	renderCartesianGrid: mocks.render,
}));
vi.mock('@belle-puzzles/solver/runtime', () => ({
	SolverSession: class {
		nextSolution = mocks.nextSolution;
	},
	shutdownSolverRuntime: vi.fn(),
}));

beforeEach(() => {
	vi.resetModules();
	mocks.nextSolution.mockReset().mockResolvedValue({
		status: 'sat',
		output: {},
	});
	mocks.render.mockReset().mockReturnValue('grid');
});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

it.each(['solve', 'render'] as const)(
	'logs the original %s exception before sending its message to the client',
	async (stage) => {
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		const error = new Error(`Internal ${stage} failure`);
		if (stage === 'solve') {
			mocks.nextSolution.mockRejectedValue(error);
		} else {
			mocks.render.mockImplementation(() => {
				throw error;
			});
		}
		const scope: {
			postMessage: ReturnType<typeof vi.fn>;
			onmessage?: (event: MessageEvent<SolverRequest>) => Promise<void>;
		} = { postMessage: vi.fn() };
		vi.stubGlobal('self', scope);
		await import('./solver.worker');
		if (!scope.onmessage)
			throw new Error('Worker handler was not installed');
		await scope.onmessage(
			new MessageEvent('message', {
				data: { type: 'start', puzzleType: 'sudoku', text: 'example' },
			})
		);
		expect(log).toHaveBeenCalledExactlyOnceWith(error);
		expect(scope.postMessage).toHaveBeenCalledWith({
			type: 'error',
			stage,
			message: error.message,
		});
	}
);

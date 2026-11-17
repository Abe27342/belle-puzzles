import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IPuzzlehuntSession } from '@belle-puzzles/puzzlehunt-model';
import {
	createNewPuzzlehunt,
	loadExistingPuzzlehunt,
} from '@belle-puzzles/puzzlehunt-model/fluid';
import { makeFluidClient } from '../fluid/client.js';
import { createPuzzlehuntProvider } from '../puzzlehunt-provider.js';

vi.mock('@belle-puzzles/puzzlehunt-model/fluid', async (importOriginal) => {
	const actual = await importOriginal<
		typeof import('@belle-puzzles/puzzlehunt-model/fluid')
	>();
	return { ...actual, loadExistingPuzzlehunt: vi.fn() };
});

describe('Puzzlehunt provider lifecycle', () => {
	const sessions: IPuzzlehuntSession[] = [];

	async function create() {
		const result = await createNewPuzzlehunt(makeFluidClient(), 'guild');
		const { session } = result;
		sessions.push(session);
		await session.puzzlehunt.flush();
		return result;
	}

	beforeEach(() => {
		vi.mocked(loadExistingPuzzlehunt).mockReset();
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		sessions.splice(0).forEach((session) => session.close());
	});

	it('closes a duplicate load and returns the cached live model', async () => {
		const { id, session: first } = await create();
		const { session: duplicate } = await create();
		vi.mocked(loadExistingPuzzlehunt)
			.mockResolvedValueOnce(first)
			.mockResolvedValueOnce(duplicate);
		const provider = createPuzzlehuntProvider();
		const models = await Promise.all([
			provider.getPuzzlehunt(id),
			provider.getPuzzlehunt(id),
		]);
		expect(models[0]).toBe(first.puzzlehunt);
		expect(models[1]).toBe(first.puzzlehunt);
		expect(duplicate.state.status).toBe('closed');
		expect(first.state.status).toBe('open');
	});

	it('evicts a terminal session so subsequent requests load a new one', async () => {
		const { id, session: first } = await create();
		const { session: replacement } = await create();
		vi.mocked(loadExistingPuzzlehunt)
			.mockResolvedValueOnce(first)
			.mockResolvedValueOnce(replacement);
		const provider = createPuzzlehuntProvider();
		await provider.getPuzzlehunt(id);
		first.close();
		expect(await provider.getPuzzlehunt(id)).toBe(replacement.puzzlehunt);
		expect(loadExistingPuzzlehunt).toHaveBeenCalledTimes(2);
	});

	it('closes the session when initial setup throws', async () => {
		const { id, session } = await create();
		vi.mocked(loadExistingPuzzlehunt).mockResolvedValueOnce(session);
		const error = new Error('Initial setup failed');
		await expect(
			createPuzzlehuntProvider().getPuzzlehunt(id, (puzzlehunt) => {
				puzzlehunt.addRound('Incomplete setup', '');
				throw error;
			})
		).rejects.toBe(error);
		expect(session.state.status).toBe('closed');
	});

	it('flushes before closing during inactivity cleanup', async () => {
		const { id, session } = await create();
		vi.mocked(loadExistingPuzzlehunt).mockResolvedValueOnce(session);
		const flush = vi.spyOn(session.puzzlehunt, 'flush');
		const close = vi.spyOn(session, 'close');
		const timers = vi.spyOn(globalThis, 'setTimeout');
		await createPuzzlehuntProvider().getPuzzlehunt(id);
		const index = timers.mock.calls.findIndex(
			([, delay]) => delay === 1000 * 60 * 10
		);
		expect(index).toBeGreaterThanOrEqual(0);
		clearTimeout(timers.mock.results[index].value);
		timers.mock.calls[index][0]();
		expect(flush).toHaveBeenCalledOnce();
		expect(close).not.toHaveBeenCalled();
		await vi.waitFor(() => {
			expect(close).toHaveBeenCalledOnce();
			expect(session.state.status).toBe('closed');
		});
	});

	it('reports a flush rejection and still closes during inactivity cleanup', async () => {
		const { id, session } = await create();
		vi.mocked(loadExistingPuzzlehunt).mockResolvedValueOnce(session);
		const error = new Error('Save failed during flush');
		vi.spyOn(session.puzzlehunt, 'flush').mockRejectedValueOnce(error);
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		const timers = vi.spyOn(globalThis, 'setTimeout');
		await createPuzzlehuntProvider().getPuzzlehunt(id);
		const index = timers.mock.calls.findIndex(
			([, delay]) => delay === 1000 * 60 * 10
		);
		expect(index).toBeGreaterThanOrEqual(0);
		clearTimeout(timers.mock.results[index].value);
		timers.mock.calls[index][0]();
		await vi.waitFor(() => {
			expect(log).toHaveBeenCalledWith(
				`Failed to save puzzlehunt ${id}.`,
				error
			);
			expect(session.state.status).toBe('closed');
		});
	});
});

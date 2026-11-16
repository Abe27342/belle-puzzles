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
		const session = await createNewPuzzlehunt(makeFluidClient(), 'guild');
		sessions.push(session);
		await session.puzzlehunt.flush();
		return session;
	}

	beforeEach(() => {
		vi.mocked(loadExistingPuzzlehunt).mockReset();
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await Promise.all(sessions.splice(0).map((session) => session.close()));
	});

	it('closes a duplicate load and returns the cached live model', async () => {
		const first = await create();
		const duplicate = await create();
		vi.mocked(loadExistingPuzzlehunt)
			.mockResolvedValueOnce(first)
			.mockResolvedValueOnce(duplicate);
		const provider = createPuzzlehuntProvider();
		const models = await Promise.all([
			provider.getPuzzlehunt(first.id),
			provider.getPuzzlehunt(first.id),
		]);
		expect(models[0]).toBe(first.puzzlehunt);
		expect(models[1]).toBe(first.puzzlehunt);
		expect(duplicate.state.status).toBe('closed');
		expect(first.state.status).toBe('open');
	});

	it('evicts a terminal session so subsequent requests load a new one', async () => {
		const first = await create();
		const replacement = await create();
		vi.mocked(loadExistingPuzzlehunt)
			.mockResolvedValueOnce(first)
			.mockResolvedValueOnce(replacement);
		const provider = createPuzzlehuntProvider();
		await provider.getPuzzlehunt(first.id);
		await first.close();
		expect(await provider.getPuzzlehunt(first.id)).toBe(
			replacement.puzzlehunt
		);
		expect(loadExistingPuzzlehunt).toHaveBeenCalledTimes(2);
	});

	it('closes the session when initial setup throws', async () => {
		const session = await create();
		vi.mocked(loadExistingPuzzlehunt).mockResolvedValueOnce(session);
		const error = new Error('Initial setup failed');
		await expect(
			createPuzzlehuntProvider().getPuzzlehunt(session.id, () => {
				throw error;
			})
		).rejects.toBe(error);
		expect(session.state.status).toBe('closed');
	});

	it('handles an asynchronous close rejection during inactivity cleanup', async () => {
		const session = await create();
		vi.mocked(loadExistingPuzzlehunt).mockResolvedValueOnce(session);
		const error = new Error('Save failed during close');
		vi.spyOn(session, 'close').mockRejectedValueOnce(error);
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		const timers = vi.spyOn(globalThis, 'setTimeout');
		await createPuzzlehuntProvider().getPuzzlehunt(session.id);
		const index = timers.mock.calls.findIndex(
			([, delay]) => delay === 1000 * 60 * 10
		);
		expect(index).toBeGreaterThanOrEqual(0);
		clearTimeout(timers.mock.results[index].value);
		timers.mock.calls[index][0]();
		await Promise.resolve();
		expect(log).toHaveBeenCalledWith(
			`Failed to close puzzlehunt ${session.id}.`,
			error
		);
	});
});

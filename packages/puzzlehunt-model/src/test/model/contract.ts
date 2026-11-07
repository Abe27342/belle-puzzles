import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IPuzzlehuntModel, PuzzlehuntView } from '../../model/types.js';

/**
 * Minimal interface for testing an `IPuzzlehuntModel` implementation.
 *
 * All clients connect to the same document.
 */
export interface ModelFixture {
	/**
	 * Initial model.
	 *
	 * @remarks
	 * This exists for convenience, as without it callers could generally load their own with {@link connect}.
	 */
	model: IPuzzlehuntModel;
	/**
	 * Connect a new client and return it.
	 */
	connect(): Promise<IPuzzlehuntModel>;
	/**
	 * Synchronize all clients, ensuring any pending edits are flushed.
	 *
	 * @remarks
	 * Contract tests should avoid assuming edits remain pending until this method is called.
	 */
	synchronize(): Promise<void>;
	/**
	 * Close all puzzlehunt models and dispose any associated resources.
	 */
	close(): Promise<void>;
}

export function comparableView(view: PuzzlehuntView) {
	return {
		rounds: view.rounds
			.map(({ children, ...round }) => ({
				...round,
				children: children.map((node) => node.id),
			}))
			.sort((a, b) => a.id.localeCompare(b.id)),
		puzzles: [...view.puzzles].sort((a, b) => a.id.localeCompare(b.id)),
	};
}

/**
 * Run a fixture of test suites that validate an {@link IPuzzlehuntModel} implementation satisfies
 * the interface contract.
 */
export function puzzlehuntModelContract(
	name: string,
	createFixture: () => Promise<ModelFixture>
) {
	describe(name, () => {
		let fixture: ModelFixture;
		let model: IPuzzlehuntModel;
		beforeEach(async () => {
			fixture = await createFixture();
			model = fixture.model;
		}, 30000);
		afterEach(async () => {
			await fixture?.close();
		}, 30000);

		it('starts empty and makes local changes visible before acknowledgement', async () => {
			expect(model.rounds).toEqual([]);
			expect(model.puzzles).toEqual([]);
			const round = model.addRound('Root', 'root-url');
			const puzzle = model.addPuzzle('Puzzle', 'puzzle-url', round);
			expect(model.isPending).toBe(true);
			expect(
				model.getRound(round.id).children.map((node) => node.id)
			).toEqual([puzzle.id]);
			expect(model.getPuzzle(puzzle.id).name).toBe('Puzzle');
			await model.flush();
			expect(model.isPending).toBe(false);
		});

		it('preserves tree structure, ordered bulk additions, and reload identity', async () => {
			const root = model.addRound('Root', '');
			model.addRounds(
				[
					{ name: 'A', url: 'a' },
					{ name: 'B', url: 'b' },
				],
				root
			);
			const child = model
				.getRound(root.id)
				.children.find((node) => node.type === 'round');
			expect(child?.type).toBe('round');
			if (!child || child.type !== 'round') {
				throw new Error('Missing child round.');
			}
			model.addPuzzles(
				[
					{ name: 'X', url: 'x' },
					{ name: 'Y', url: 'y' },
				],
				child
			);
			expect(
				model.getRound(root.id).children.map((node) => node.name)
			).toEqual(['A', 'B']);
			expect(
				model.getRound(child.id).children.map((node) => node.name)
			).toEqual(['X', 'Y']);
			await model.flush();
			const other = await fixture.connect();
			await fixture.synchronize();
			expect(comparableView(other.view)).toEqual(
				comparableView(model.view)
			);
		});

		it('moves puzzles and nested rounds without changing identity', async () => {
			const root = model.addRound('Root', '');
			const a = model.addRound('A', '', root);
			const b = model.addRound('B', '', root);
			const nested = model.addRound('Nested', '', a);
			const puzzle = model.addPuzzle('Puzzle', '', nested);
			model.move(nested, b);
			expect(model.getRound(a.id).children).toEqual([]);
			expect(model.getRound(b.id).children[0].id).toBe(nested.id);
			expect(model.getPuzzle(puzzle.id).parentId).toBe(nested.id);
			model.move(puzzle, a);
			await model.flush();
			expect(model.getPuzzle(puzzle.id).parentId).toBe(a.id);
			expect(model.getRound(nested.id).children).toEqual([]);
		});

		it('keeps depth-first sibling order after refreshing and opening another model', async () => {
			const a = model.addRound('A', '');
			const b = model.addRound('B', '');
			const nested = model.addRound('Nested', '', a);
			model.addPuzzle('Nested puzzle', '', nested);
			model.addPuzzle('Direct puzzle', '', a);
			model.addPuzzle('Other puzzle', '', b);
			expect(model.rounds.map((node) => node.name)).toEqual([
				'A',
				'Nested',
				'B',
			]);
			expect(model.puzzles.map((node) => node.name)).toEqual([
				'Nested puzzle',
				'Direct puzzle',
				'Other puzzle',
			]);
			await model.flush();
			const other = await fixture.connect();
			await fixture.synchronize();
			expect(other.rounds.map((node) => node.name)).toEqual([
				'A',
				'Nested',
				'B',
			]);
			expect(other.puzzles.map((node) => node.name)).toEqual([
				'Nested puzzle',
				'Direct puzzle',
				'Other puzzle',
			]);
		});

		it('renames, updates URLs, and associates sheets without changing other fields', async () => {
			const round = model.addRound('Round', 'round-url');
			const puzzle = model.addPuzzle('Puzzle', 'puzzle-url', round);
			model.changeName(round, 'New round');
			model.changeName(puzzle, 'New puzzle');
			model.changeUrl(puzzle, 'new-url');
			model.augmentWithGoogleSheet(puzzle, 'sheet');
			await model.flush();
			expect(model.getRound(round.id).name).toBe('New round');
			expect(model.getRound(round.id).url).toBe('round-url');
			expect(model.getPuzzle(puzzle.id)).toMatchObject({
				name: 'New puzzle',
				url: 'new-url',
				sheetId: 'sheet',
				parentId: round.id,
			});
		});

		it('solves, re-solves, and unsolves without disturbing puzzle identity', async () => {
			const round = model.addRound('Root', '');
			const puzzle = model.addPuzzle('Puzzle', '', round);
			expect(model.solve(puzzle.id, 'FIRST').answer).toBe('FIRST');
			expect(model.solve(puzzle.id, 'SECOND').answer).toBe('SECOND');
			expect(model.unsolve(puzzle.id).answer).toBeUndefined();
			expect(model.unsolve(puzzle.id).answer).toBeUndefined();
			await model.flush();
			expect(model.getPuzzle(puzzle.id).answer).toBeUndefined();
			expect(model.getPuzzle(puzzle.id).parentId).toBe(round.id);
		});

		it('keeps status and its timestamp coherent when updating and clearing', async () => {
			const round = model.addRound('Root', '');
			const puzzle = model.addPuzzle('Puzzle', '', round);
			model.updateStatus(puzzle, 'Working');
			await model.flush();
			expect(model.getPuzzle(puzzle.id).status).toBe('Working');
			expect(
				Number.isSafeInteger(
					model.getPuzzle(puzzle.id).lastStatusUpdate
				)
			).toBe(true);
			model.clearStatus(puzzle);
			model.clearStatus(puzzle);
			await model.flush();
			expect(model.getPuzzle(puzzle.id).status).toBeUndefined();
			expect(model.getPuzzle(puzzle.id).lastStatusUpdate).toBeUndefined();
		});

		it('deletes the complete subtree while preserving siblings', async () => {
			const root = model.addRound('Root', '');
			const child = model.addRound('Child', '', root);
			model.addPuzzle('Deleted', '', child);
			const kept = model.addPuzzle('Kept', '', root);
			model.delete(child);
			expect(model.puzzles.map((node) => node.id)).toEqual([kept.id]);
			await model.flush();
			expect(model.rounds.map((node) => node.id)).toEqual([root.id]);
			expect(
				model.getRound(root.id).children.map((node) => node.id)
			).toEqual([kept.id]);
		});

		it('preserves simultaneous independent additions from two connected models', async () => {
			const root = model.addRound('Root', '');
			await model.flush();
			const other = await fixture.connect();
			model.addPuzzle('First', '', model.getRound(root.id));
			other.addPuzzle('Second', '', other.getRound(root.id));
			await fixture.synchronize();
			expect(model.puzzles.map((node) => node.name).sort()).toEqual([
				'First',
				'Second',
			]);
			expect(comparableView(other.view)).toEqual(
				comparableView(model.view)
			);
		});

		it('preserves concurrent assignments to different fields', async () => {
			const root = model.addRound('Root', '');
			const puzzle = model.addPuzzle('Puzzle', '', root);
			await model.flush();
			const other = await fixture.connect();
			model.changeName(model.getPuzzle(puzzle.id), 'Renamed');
			other.changeUrl(other.getPuzzle(puzzle.id), 'new-url');
			await fixture.synchronize();
			expect(model.getPuzzle(puzzle.id)).toMatchObject({
				name: 'Renamed',
				url: 'new-url',
			});
			expect(comparableView(other.view)).toEqual(
				comparableView(model.view)
			);
		});

		it('keeps the later service-ordered solve from a previously loaded model', async () => {
			const root = model.addRound('Root', '');
			const puzzle = model.addPuzzle('Puzzle', '', root);
			await model.flush();
			const other = await fixture.connect();
			model.solve(puzzle.id, 'FIRST');
			await model.flush();
			other.solve(puzzle.id, 'SECOND');
			await fixture.synchronize();
			expect(model.getPuzzle(puzzle.id).answer).toBe('SECOND');
			expect(other.getPuzzle(puzzle.id).answer).toBe('SECOND');
		});

		it('notifies without exposing tree internals and supports unsubscribe', async () => {
			const listener = vi.fn();
			const unsubscribe = model.subscribe(listener);
			model.addRound('First', '');
			expect(listener).toHaveBeenCalled();
			await model.flush();
			expect(listener.mock.calls.every((args) => args.length === 0)).toBe(
				true
			);
			unsubscribe();
			listener.mockClear();
			model.addRound('Second', '');
			await model.flush();
			expect(listener).not.toHaveBeenCalled();
		});
	});
}

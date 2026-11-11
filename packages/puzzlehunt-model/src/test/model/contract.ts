import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IPuzzlehuntModel, PuzzlehuntView } from '../../model/types.js';

/**
 * Minimal interface for testing an `IPuzzlehuntModel` implementation.
 *
 * Clients returned by connect share the initial document; createHunt creates an isolated document.
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
	/** Create another hunt in the same service/guild without resetting existing hunts. */
	createHunt(): Promise<IPuzzlehuntModel>;
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

		function seed() {
			const round = model.addRound('Round', 'round-url');
			const puzzle = model.addPuzzle('Puzzle', 'puzzle-url', round);
			return { round, puzzle };
		}

		async function reload() {
			await model.flush();
			const other = await fixture.connect();
			await fixture.synchronize();
			return other;
		}

		describe('rounds', () => {
			it('starts empty', () => {
				expect(model.rounds).toEqual([]);
			});

			it('enumerates rounds in depth-first sibling order', async () => {
				const a = model.addRound('A', '');
				model.addRound('B', '');
				model.addRound('Nested', '', a);
				const other = await reload();
				expect(other.rounds.map((node) => node.name)).toEqual([
					'A',
					'Nested',
					'B',
				]);
			});
		});

		describe('puzzles', () => {
			it('starts empty', () => {
				expect(model.puzzles).toEqual([]);
			});

			it('enumerates puzzles in depth-first sibling order', async () => {
				const a = model.addRound('A', '');
				const b = model.addRound('B', '');
				const nested = model.addRound('Nested', '', a);
				model.addPuzzle('Nested puzzle', '', nested);
				model.addPuzzle('Direct puzzle', '', a);
				model.addPuzzle('Other puzzle', '', b);
				expect(
					(await reload()).puzzles.map((node) => node.name)
				).toEqual(['Nested puzzle', 'Direct puzzle', 'Other puzzle']);
			});
		});

		describe('getRound', () => {
			it('finds a round by its stable identity after reload', async () => {
				const round = model.addRound('Round', 'url');
				expect((await reload()).getRound(round.id)).toMatchObject({
					id: round.id,
					name: 'Round',
					url: 'url',
				});
			});

			it('rejects unknown identities', () => {
				expect(() => model.getRound(crypto.randomUUID())).toThrow();
			});
		});

		describe('getPuzzle', () => {
			it('finds a puzzle by its stable identity after reload', async () => {
				const { puzzle } = seed();
				expect((await reload()).getPuzzle(puzzle.id)).toMatchObject({
					id: puzzle.id,
					name: 'Puzzle',
					url: 'puzzle-url',
				});
			});

			it('rejects a round identity', () => {
				const round = model.addRound('Round', '');
				expect(() => model.getPuzzle(round.id)).toThrow();
			});

			it('rejects unknown identities', () => {
				expect(() => model.getPuzzle(crypto.randomUUID())).toThrow();
			});
		});

		describe('addRound', () => {
			it('adds a root round synchronously', async () => {
				const round = model.addRound('Root', 'url');
				expect(model.getRound(round.id)).toMatchObject({
					name: 'Root',
					url: 'url',
					parentId: null,
				});
				expect((await reload()).getRound(round.id).parentId).toBeNull();
			});

			it('adds a nested round to its parent', async () => {
				const parent = model.addRound('Parent', '');
				const child = model.addRound('Child', '', parent);
				expect(
					(await reload())
						.getRound(parent.id)
						.children.map((node) => node.id)
				).toEqual([child.id]);
			});
		});

		describe('addRounds', () => {
			it('appends a bulk addition in input order', async () => {
				const root = model.addRound('Root', '');
				model.addRound('Existing', '', root);
				model.addRounds(
					[
						{ name: 'A', url: 'a' },
						{ name: 'B', url: 'b' },
					],
					root
				);
				expect(
					(await reload())
						.getRound(root.id)
						.children.map(({ name, url }) => ({ name, url }))
				).toEqual([
					{ name: 'Existing', url: '' },
					{ name: 'A', url: 'a' },
					{ name: 'B', url: 'b' },
				]);
			});
		});

		describe('addPuzzle', () => {
			it('adds a puzzle synchronously under its round', async () => {
				const { round, puzzle } = seed();
				expect(model.getPuzzle(puzzle.id).parentId).toBe(round.id);
				expect(
					(await reload())
						.getRound(round.id)
						.children.map((node) => node.id)
				).toEqual([puzzle.id]);
			});
		});

		describe('addPuzzles', () => {
			it('appends a bulk addition in input order', async () => {
				const { round } = seed();
				model.addPuzzles(
					[
						{ name: 'X', url: 'x' },
						{ name: 'Y', url: 'y' },
					],
					round
				);
				expect(
					(await reload())
						.getRound(round.id)
						.children.map(({ name, url }) => ({ name, url }))
				).toEqual([
					{ name: 'Puzzle', url: 'puzzle-url' },
					{ name: 'X', url: 'x' },
					{ name: 'Y', url: 'y' },
				]);
			});
		});

		describe('delete', () => {
			it('deletes a puzzle without deleting its parent', async () => {
				const { round, puzzle } = seed();
				model.delete(puzzle);
				const other = await reload();
				expect(other.getRound(round.id).children).toEqual([]);
				expect(() => other.getPuzzle(puzzle.id)).toThrow();
			});

			it('deletes a complete subtree while preserving siblings', async () => {
				const root = model.addRound('Root', '');
				const child = model.addRound('Child', '', root);
				model.addPuzzle('Deleted', '', child);
				const kept = model.addPuzzle('Kept', '', root);
				model.delete(child);
				const other = await reload();
				expect(other.rounds.map((node) => node.id)).toEqual([root.id]);
				expect(other.puzzles.map((node) => node.id)).toEqual([kept.id]);
				expect(
					other.getRound(root.id).children.map((node) => node.id)
				).toEqual([kept.id]);
			});
		});

		describe('changeName', () => {
			it.each(['round', 'puzzle'] as const)(
				'renames a %s without changing its other properties',
				async (type) => {
					const { round, puzzle } = seed();
					model.changeName(
						type === 'round' ? round : puzzle,
						'Renamed'
					);
					const other = await reload();
					expect(
						type === 'round'
							? other.getRound(round.id)
							: other.getPuzzle(puzzle.id)
					).toMatchObject({
						name: 'Renamed',
						url: `${type}-url`,
					});
				}
			);
		});

		describe('changeUrl', () => {
			it.each(['round', 'puzzle'] as const)(
				'changes a %s URL without changing its name',
				async (type) => {
					const { round, puzzle } = seed();
					model.changeUrl(
						type === 'round' ? round : puzzle,
						'new-url'
					);
					const other = await reload();
					expect(
						type === 'round'
							? other.getRound(round.id)
							: other.getPuzzle(puzzle.id)
					).toMatchObject({
						name: type === 'round' ? 'Round' : 'Puzzle',
						url: 'new-url',
					});
				}
			);
		});

		describe('move', () => {
			it('moves a puzzle without changing its identity', async () => {
				const { round, puzzle } = seed();
				const destination = model.addRound('Destination', '');
				model.move(puzzle, destination);
				const other = await reload();
				expect(other.getRound(round.id).children).toEqual([]);
				expect(other.getPuzzle(puzzle.id).parentId).toBe(
					destination.id
				);
			});

			it('moves a round with its subtree intact', async () => {
				const root = model.addRound('Root', '');
				const a = model.addRound('A', '', root);
				const b = model.addRound('B', '', root);
				const nested = model.addRound('Nested', '', a);
				const puzzle = model.addPuzzle('Puzzle', '', nested);
				model.move(nested, b);
				const other = await reload();
				expect(other.getRound(a.id).children).toEqual([]);
				expect(
					other.getRound(b.id).children.map((node) => node.id)
				).toEqual([nested.id]);
				expect(other.getPuzzle(puzzle.id).parentId).toBe(nested.id);
			});

			it('preserves membership when moving to the current parent', async () => {
				const { round, puzzle } = seed();
				model.addPuzzle('Sibling', '', round);
				const before = model
					.getRound(round.id)
					.children.map((node) => node.id);
				model.move(puzzle, round);
				const current = await reload();
				expect(current.getPuzzle(puzzle.id).parentId).toBe(round.id);
				expect(
					current
						.getRound(round.id)
						.children.map((node) => node.id)
						.sort()
				).toEqual(before.sort());
			});
		});

		describe('solve', () => {
			it('sets an answer synchronously and persists it', async () => {
				const { puzzle } = seed();
				expect(model.solve(puzzle.id, 'ANSWER').answer).toBe('ANSWER');
				expect((await reload()).getPuzzle(puzzle.id).answer).toBe(
					'ANSWER'
				);
			});

			it('replaces an existing answer', async () => {
				const { puzzle } = seed();
				model.solve(puzzle.id, 'FIRST');
				await model.flush();
				model.solve(puzzle.id, 'SECOND');
				expect((await reload()).getPuzzle(puzzle.id).answer).toBe(
					'SECOND'
				);
			});
		});

		describe('unsolve', () => {
			it('clears an answer without changing identity or parent', async () => {
				const { round, puzzle } = seed();
				model.solve(puzzle.id, 'ANSWER');
				await model.flush();
				expect(model.unsolve(puzzle.id).answer).toBeUndefined();
				const current = (await reload()).getPuzzle(puzzle.id);
				expect(current.answer).toBeUndefined();
				expect(current.parentId).toBe(round.id);
			});

			it('is idempotent on an unsolved puzzle', async () => {
				const { puzzle } = seed();
				model.unsolve(puzzle.id);
				model.unsolve(puzzle.id);
				expect(
					(await reload()).getPuzzle(puzzle.id).answer
				).toBeUndefined();
			});
		});

		describe('updateStatus', () => {
			it('persists status and timestamp together', async () => {
				const { puzzle } = seed();
				model.updateStatus(puzzle, 'Working');
				const current = (await reload()).getPuzzle(puzzle.id);
				expect(current.status).toBe('Working');
				expect(Number.isSafeInteger(current.lastStatusUpdate)).toBe(
					true
				);
			});
		});

		describe('clearStatus', () => {
			it('removes status and timestamp together', async () => {
				const { puzzle } = seed();
				model.updateStatus(puzzle, 'Working');
				await model.flush();
				model.clearStatus(puzzle);
				const current = (await reload()).getPuzzle(puzzle.id);
				expect(current.status).toBeUndefined();
				expect(current.lastStatusUpdate).toBeUndefined();
			});

			it('is idempotent when status is absent', async () => {
				const { puzzle } = seed();
				model.clearStatus(puzzle);
				model.clearStatus(puzzle);
				expect(
					(await reload()).getPuzzle(puzzle.id).status
				).toBeUndefined();
			});
		});

		describe('augmentWithGoogleSheet', () => {
			it('persists a sheet association without changing other fields', async () => {
				const { round, puzzle } = seed();
				model.augmentWithGoogleSheet(puzzle, 'sheet');
				expect((await reload()).getPuzzle(puzzle.id)).toMatchObject({
					name: 'Puzzle',
					url: 'puzzle-url',
					parentId: round.id,
					sheetId: 'sheet',
				});
			});
		});

		describe('document isolation', () => {
			it('does not expose additions from another hunt', async () => {
				const otherHunt = await fixture.createHunt();
				model.addRound('First hunt', '');
				otherHunt.addRound('Second hunt', '');
				await fixture.synchronize();
				expect(model.rounds.map((node) => node.name)).toEqual([
					'First hunt',
				]);
				expect(otherHunt.rounds.map((node) => node.name)).toEqual([
					'Second hunt',
				]);
			});

			it('does not change another hunt when assigning properties', async () => {
				const { puzzle } = seed();
				const otherHunt = await fixture.createHunt();
				const otherRound = otherHunt.addRound('Other', '');
				const otherPuzzle = otherHunt.addPuzzle(
					'Untouched',
					'',
					otherRound
				);
				await fixture.synchronize();
				model.changeName(puzzle, 'Changed');
				await fixture.synchronize();
				expect(otherHunt.getPuzzle(otherPuzzle.id).name).toBe(
					'Untouched'
				);
				expect(() => otherHunt.getPuzzle(puzzle.id)).toThrow();
			});

			it('does not delete another hunt when deleting a subtree', async () => {
				const { round } = seed();
				const otherHunt = await fixture.createHunt();
				const kept = otherHunt.addRound('Kept', '');
				await fixture.synchronize();
				model.delete(round);
				await fixture.synchronize();
				expect(model.rounds).toEqual([]);
				expect(otherHunt.getRound(kept.id).name).toBe('Kept');
			});
		});

		describe('concurrent commands', () => {
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
		});

		describe('subscribe', () => {
			it('notifies without exposing tree internals', async () => {
				const listener = vi.fn();
				model.subscribe(listener);
				model.addRound('First', '');
				expect(listener).toHaveBeenCalled();
				await model.flush();
				expect(
					listener.mock.calls.every((args) => args.length === 0)
				).toBe(true);
			});

			it('stops notifying after unsubscribe', async () => {
				const listener = vi.fn();
				const unsubscribe = model.subscribe(listener);
				unsubscribe();
				model.addRound('Second', '');
				await model.flush();
				expect(listener).not.toHaveBeenCalled();
			});
		});

		describe('flush', () => {
			it('settles locally visible changes', async () => {
				model.addRound('Pending', '');
				expect(model.isPending).toBe(true);
				await model.flush();
				expect(model.isPending).toBe(false);
			});
		});

		describe('refresh', () => {
			it('incorporates edits from another model', async () => {
				const other = await fixture.connect();
				other.addRound('Remote', '');
				await other.flush();
				await model.refresh();
				await vi.waitFor(() =>
					expect(model.rounds.map((node) => node.name)).toEqual([
						'Remote',
					])
				);
			});
		});
	});
}

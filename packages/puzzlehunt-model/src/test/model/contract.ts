import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
	IPuzzlehuntModel,
	PuzzlehuntView,
	PuzzlehuntChangeEvent,
} from '../../model/types.js';
import { HuntCommandError } from '../../document.js';

/**
 * Minimal interface for testing an `IPuzzlehuntModel` implementation.
 *
 * Clients returned by createModel share the named hunt's document, defaulting to the initial hunt;
 * createHunt creates an isolated document.
 */
export interface ModelFixture {
	/**
	 * Initial model.
	 *
	 * @remarks
	 * This exists for convenience, as without it callers could generally load their own with {@link createModel}.
	 */
	model: IPuzzlehuntModel;
	/**
	 * Connect a new client to the named hunt, or the initial hunt when omitted, and return it.
	 */
	createModel(huntName?: string): Promise<IPuzzlehuntModel>;
	/**
	 * Create another named hunt in the same service/guild.
	 *
	 * @remarks
	 * This allows validating cross-hunt isolation at the model level (i.e. ensuring changes in one hunt do not affect another).
	 */
	createHunt(huntName: string): Promise<IPuzzlehuntModel>;
	/**
	 * Synchronize clients for the named hunt, or the initial hunt when omitted,
	 * ensuring any pending edits are flushed.
	 *
	 * @remarks
	 * Contract tests should avoid assuming edits remain pending until this method is called.
	 */
	synchronize(huntName?: string): Promise<void>;
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
			const other = await fixture.createModel();
			await fixture.synchronize();
			return other;
		}

		it('persists logging configuration across clients without node changes', async () => {
			const other = await fixture.createModel();
			expect(model.guildId).toBe(other.guildId);
			const metadataChanges = vi.fn();
			const unsubscribe = other.subscribe(() =>
				metadataChanges(other.loggingChannelIds)
			);
			const changes = vi.fn();
			model.subscribeChanges(changes);
			const ids = {
				puzzleAdd: 'add-channel',
				puzzleSolve: 'solve-channel',
				puzzleStatusUpdate: 'status-channel',
			};
			model.setLoggingChannelIds(ids);
			expect(model.loggingChannelIds).toEqual(ids);
			await fixture.synchronize();
			await vi.waitFor(() =>
				expect(other.loggingChannelIds).toEqual(ids)
			);
			await vi.waitFor(() =>
				expect(metadataChanges).toHaveBeenCalledWith(ids)
			);
			unsubscribe();
			expect((await reload()).loggingChannelIds).toEqual(ids);
			expect(changes).not.toHaveBeenCalled();
		});

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

			it('rejects attempts to add a puzzle to a non-existent round', () => {
				const fakeRound = { id: crypto.randomUUID() } as any;
				expect(() =>
					model.addPuzzle('Puzzle', 'url', fakeRound)
				).toThrow(HuntCommandError);
			});

			it('enumerates puzzles in depth-first sibling order', async () => {
				const a = model.addRound('A', '');
				const b = model.addRound('B', '');
				const nested = model.addRound('Nested', '', a);
				model.addPuzzle('Nested puzzle', '', nested);
				model.addPuzzle('Direct puzzle', '', a);
				model.addPuzzle('Other puzzle', '', b);

				const reloaded = await reload();
				expect(reloaded.puzzles.map((node) => node.name)).toEqual([
					'Nested puzzle',
					'Direct puzzle',
					'Other puzzle',
				]);
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
					parentId: undefined,
				});
				expect(
					(await reload()).getRound(round.id).parentId
				).toBeUndefined();
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
				const otherHunt = await fixture.createHunt('Other hunt');
				model.addRound('First hunt', '');
				otherHunt.addRound('Second hunt', '');
				await fixture.synchronize();
				await fixture.synchronize('Other hunt');
				expect(model.rounds.map((node) => node.name)).toEqual([
					'First hunt',
				]);
				expect(otherHunt.rounds.map((node) => node.name)).toEqual([
					'Second hunt',
				]);
			});

			// This (and some other tests in this describe block) are more targeted at validating the harness
			// being used has the correct semantics with respect to multiple documents.
			it('reopens named hunts while defaulting to the initial hunt', async () => {
				const otherHunt = await fixture.createHunt('Other hunt');
				const thirdHunt = await fixture.createHunt('Third hunt');
				const initialRound = model.addRound('Initial round', '');
				const otherRound = otherHunt.addRound('Other round', '');
				const thirdRound = thirdHunt.addRound('Third round', '');
				await fixture.synchronize();
				await fixture.synchronize('Other hunt');
				await fixture.synchronize('Third hunt');
				const other = await fixture.createModel('Other hunt');
				const third = await fixture.createModel('Third hunt');
				const initial = await fixture.createModel();
				await fixture.synchronize();
				await fixture.synchronize('Other hunt');
				await fixture.synchronize('Third hunt');
				expect(other.rounds.map((node) => node.id)).toEqual([
					otherRound.id,
				]);
				expect(third.rounds.map((node) => node.id)).toEqual([
					thirdRound.id,
				]);
				expect(initial.rounds.map((node) => node.id)).toEqual([
					initialRound.id,
				]);
			});

			it.each([undefined, 'Other hunt'])(
				'synchronizes only the selected hunt (%s)',
				async (huntName) => {
					const otherHunt = await fixture.createHunt('Other hunt');
					const selected = huntName === undefined ? model : otherHunt;
					const unrelated =
						huntName === undefined ? otherHunt : model;
					const connected = await fixture.createModel(huntName);
					const flush = vi.spyOn(unrelated, 'flush');
					const refresh = vi.spyOn(unrelated, 'refresh');
					selected.addRound('Selected', '');
					unrelated.addRound('Unrelated', '');
					await fixture.synchronize(huntName);
					expect(connected.rounds.map((node) => node.name)).toEqual([
						'Selected',
					]);
					expect(flush).not.toHaveBeenCalled();
					expect(refresh).not.toHaveBeenCalled();
				}
			);

			it('rejects unknown hunt names', async () => {
				await expect(
					fixture.createModel('Unknown hunt')
				).rejects.toThrow('Unknown hunt');
				await expect(
					fixture.synchronize('Unknown hunt')
				).rejects.toThrow('Unknown hunt');
			});

			it('rejects duplicate hunt names', async () => {
				await fixture.createHunt('Other hunt');
				await expect(fixture.createHunt('Other hunt')).rejects.toThrow(
					'Hunt already exists'
				);
			});

			it('does not change another hunt when assigning properties', async () => {
				const { puzzle } = seed();
				const otherHunt = await fixture.createHunt('Other hunt');
				const otherRound = otherHunt.addRound('Other', '');
				const otherPuzzle = otherHunt.addPuzzle(
					'Untouched',
					'',
					otherRound
				);
				await fixture.synchronize();
				await fixture.synchronize('Other hunt');
				model.changeName(puzzle, 'Changed');
				await fixture.synchronize();
				await fixture.synchronize('Other hunt');
				expect(otherHunt.getPuzzle(otherPuzzle.id).name).toBe(
					'Untouched'
				);
				expect(() => otherHunt.getPuzzle(puzzle.id)).toThrow();
			});

			it('does not delete another hunt when deleting a subtree', async () => {
				const { round } = seed();
				const otherHunt = await fixture.createHunt('Other hunt');
				const kept = otherHunt.addRound('Kept', '');
				await fixture.synchronize();
				await fixture.synchronize('Other hunt');
				model.delete(round);
				await fixture.synchronize();
				await fixture.synchronize('Other hunt');
				expect(model.rounds).toEqual([]);
				expect(otherHunt.getRound(kept.id).name).toBe('Kept');
			});
		});

		describe('concurrent commands', () => {
			it('preserves simultaneous independent additions from two connected models', async () => {
				const root = model.addRound('Root', '');
				await model.flush();
				const other = await fixture.createModel();
				model.addPuzzle('First', '', model.getRound(root.id));
				other.addPuzzle('Second', '', other.getRound(root.id));
				await fixture.synchronize();
				// The sort() is necessary as append order is not guaranteed.
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
				const other = await fixture.createModel();
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
				const other = await fixture.createModel();
				model.solve(puzzle.id, 'FIRST');
				await model.flush();
				other.solve(puzzle.id, 'SECOND');
				await fixture.synchronize();
				expect(model.getPuzzle(puzzle.id).answer).toBe('SECOND');
				expect(other.getPuzzle(puzzle.id).answer).toBe('SECOND');
			});
		});

		describe('subscribeChanges', () => {
			it.each(['addPuzzles', 'addRounds'] as const)(
				'batches %s and does not repeat unchanged acknowledgements',
				async (operation) => {
					const root = model.addRound('Root', '');
					await model.flush();
					const events: PuzzlehuntChangeEvent[] = [];
					model.subscribeChanges((event) => events.push(event));
					model[operation](
						[
							{ name: 'A', url: 'a' },
							{ name: 'B', url: 'b' },
						],
						root
					);
					expect(events).toHaveLength(1);
					expect(events[0].before.rounds[0].children).toEqual([]);
					expect(
						events[0].changes.map((change) => change.type)
					).toEqual(['node-added', 'node-added']);
					expect(
						events[0].after.rounds[0].children.map(
							(node) => node.name
						)
					).toEqual(['A', 'B']);
					expect(
						events[0].changes.every(
							(change) =>
								change.type === 'node-added' &&
								typeof change.node.id === 'string'
						)
					).toBe(true);
					await model.flush();
					expect(events).toHaveLength(1);
				}
			);

			it('reports full values once for property, association and status edits', async () => {
				const { puzzle } = seed();
				await model.flush();
				const events: PuzzlehuntChangeEvent[] = [];
				model.subscribeChanges((event) => events.push(event));
				model.changeName(puzzle, 'Renamed');
				model.changeUrl(puzzle, 'updated-url');
				model.augmentWithGoogleSheet(puzzle, 'sheet');
				model.solve(puzzle.id, 'ANSWER');
				model.updateStatus(puzzle, 'Working');
				expect(events).toHaveLength(5);
				for (const event of events) {
					expect(event.changes).toHaveLength(1);
					expect(event.changes[0]).toMatchObject({
						type: 'node-changed',
						before: {
							id: puzzle.id,
							type: 'puzzle',
							parentId: puzzle.parentId,
						},
						after: {
							id: puzzle.id,
							type: 'puzzle',
							parentId: puzzle.parentId,
						},
					});
				}
				expect(events[4].changes[0]).toMatchObject({
					before: {
						name: 'Renamed',
						url: 'updated-url',
						sheetId: 'sheet',
						answer: 'ANSWER',
					},
					after: {
						name: 'Renamed',
						url: 'updated-url',
						status: 'Working',
						lastStatusUpdate: expect.any(Number),
					},
				});
				await model.flush();
			});

			it('keeps removal subtrees and prior association values historical', async () => {
				const { round, puzzle } = seed();
				const child = model.addRound('Child', '', round);
				const nested = model.addPuzzle('Nested', '', child);
				model.augmentWithGoogleSheet(nested, 'retained-sheet');
				await model.flush();
				const events: PuzzlehuntChangeEvent[] = [];
				const unsubscribe = model.subscribeChanges((event) =>
					events.push(event)
				);
				model.delete(round);
				expect(events).toHaveLength(1);
				const saved = JSON.stringify(events[0]);
				expect(events[0].after).toEqual({ rounds: [], puzzles: [] });
				expect(events[0].changes.map((change) => change.type)).toEqual(
					Array(4).fill('node-removed')
				);
				expect(
					events[0].changes
						.map(
							(change) =>
								change.type === 'node-removed' && change.node.id
						)
						.sort()
				).toEqual([round.id, child.id, puzzle.id, nested.id].sort());
				expect(
					events[0].before.puzzles.find(
						(node) => node.id === nested.id
					)?.sheetId
				).toBe('retained-sheet');
				await model.flush();
				unsubscribe();
				model.addRound('Later', '');
				await model.flush();
				expect(events).toHaveLength(1);
				expect(JSON.stringify(events[0])).toBe(saved);
			});

			it('reports moves with old and new parent views', async () => {
				const { round, puzzle } = seed();
				const sibling = model.addPuzzle('Sibling', '', round);
				const destination = model.addRound('Destination', '');
				await model.flush();
				const events: PuzzlehuntChangeEvent[] = [];
				model.subscribeChanges((event) => events.push(event));
				model.move(puzzle, destination);
				expect(events).toHaveLength(1);
				expect(events[0].changes).toEqual(
					expect.arrayContaining([
						{
							type: 'node-changed',
							before: expect.objectContaining({
								id: puzzle.id,
								parentId: round.id,
								position: 0,
							}),
							after: expect.objectContaining({
								id: puzzle.id,
								parentId: destination.id,
								position: 0,
							}),
						},
					])
				);
				expect(
					events[0].before.rounds
						.find((node) => node.id === round.id)
						?.children.map((node) => node.id)
				).toEqual([puzzle.id, sibling.id]);
				expect(
					events[0].after.rounds
						.find((node) => node.id === destination.id)
						?.children.map((node) => node.id)
				).toEqual([puzzle.id]);
				await model.flush();
			});

			it('normalizes remote edits and suppresses no-op assignments', async () => {
				const { puzzle } = seed();
				const other = await reload();
				const events: PuzzlehuntChangeEvent[] = [];
				model.subscribeChanges((event) => events.push(event));
				model.changeName(puzzle, puzzle.name);
				await model.flush();
				expect(events).toEqual([]);
				other.changeName(other.getPuzzle(puzzle.id), 'Remote');
				await fixture.synchronize();
				expect(events).toHaveLength(1);
				expect(events[0].changes[0]).toMatchObject({
					type: 'node-changed',
					before: { id: puzzle.id, name: puzzle.name },
					after: { id: puzzle.id, name: 'Remote' },
				});
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
				const other = await fixture.createModel();
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

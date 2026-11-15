import { beforeEach, afterEach, describe, expect, inject, it, vi } from 'vitest';
import { AzureClient } from '@fluidframework/azure-client';
import { InsecureTokenProvider } from '@fluidframework/test-client-utils';
import {
	createNewPuzzlehunt,
	IPuzzlehunt,
	Puzzle,
	Round,
} from '../puzzlehunt.js';
import { TestLogger } from './utils.js';
import type {
	DocumentNode,
	DocumentPuzzle,
	DocumentRound,
} from '../document.js';
import type { PuzzlehuntChangeEvent } from '../model/types.js';

const guildId = 'mock-guild-id';
const user = {
	id: 'test user id',
	name: 'test user',
};

describe('Puzzlehunt', () => {
	let puzzlehunt: IPuzzlehunt;
	let disposer: { dispose: () => void };
	let logger: TestLogger;

	beforeEach(async () => {
		logger = new TestLogger();
		const client = new AzureClient({
			connection: {
				type: 'local',
				tokenProvider: new InsecureTokenProvider('', user),
				endpoint: inject('fluidEndpoint'),
			},
			logger,
		});
		const results = await createNewPuzzlehunt(client, guildId);
		puzzlehunt = results.puzzlehunt;
		disposer = results.disposer;
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		disposer.dispose();
		puzzlehunt = undefined;
		disposer = undefined;
		expect(logger.errorEvents).toEqual([]);
	});

	it('starts empty', () => {
		expect(Array.from(puzzlehunt.rounds)).toEqual([]);
		expect(Array.from(puzzlehunt.puzzles)).toEqual([]);
	});

	describe('supports round addition', () => {
		it('via .addRound', () => {
			const round = puzzlehunt.addRound('Test round 1', 'mock url');
			expect(round.children).toEqual([]);
			expect(round.name).toEqual('Test round 1');
			expect(round.url).toEqual('mock url');
			const allRounds = Array.from(puzzlehunt.rounds);
			expect(allRounds).toHaveLength(1);
			expect(allRounds[0].id).toEqual(round.id);
		});

		it('via .addRounds', () => {
			let rootRound = puzzlehunt.addRound('root', 'rootUrl');
			puzzlehunt.addRounds(
				[
					{ name: 'child 1', url: 'child 1 url' },
					{ name: 'child 2', url: 'child 2 url' },
				],
				rootRound
			);
			// auto-refresh doesn't happen: handles needs to be refreshed manually.
			// This is true throughout the tests.
			rootRound = puzzlehunt.getRound(rootRound.id);
			expect(rootRound.children).toHaveLength(2);
			expect(
				rootRound.children.map((child) => ({
					name: child.name,
					url: child.url,
					roundId: child.roundId,
				}))
			).toEqual([
				{ name: 'child 1', url: 'child 1 url', roundId: rootRound.id },
				{ name: 'child 2', url: 'child 2 url', roundId: rootRound.id },
			]);
			expect(Array.from(puzzlehunt.rounds)).toHaveLength(3);
		});
	});

	it('supports round deletion', () => {
		const round = puzzlehunt.addRound('Test round 1', 'mock url');
		puzzlehunt.delete(round);
		expect(Array.from(puzzlehunt.rounds)).toHaveLength(0);
	});

	describe('supports puzzle addition', () => {
		let round: Round;
		beforeEach(() => {
			round = puzzlehunt.addRound('root round', 'root url');
		});

		it('via .addPuzzle', () => {
			const puzzle = puzzlehunt.addPuzzle(
				'test puzzle',
				'test url',
				round
			);
			expect(puzzle.name).toEqual('test puzzle');
			expect(puzzle.url).toEqual('test url');
			expect(puzzle.roundId).toEqual(round.id);
			const allPuzzles = Array.from(puzzlehunt.puzzles);
			expect(allPuzzles).toHaveLength(1);
			expect(allPuzzles[0].id).toEqual(puzzle.id);
		});

		it('via .addPuzzles', () => {
			puzzlehunt.addPuzzles(
				[
					{ name: 'test puzzle 1', url: 'test puzzle 1 url' },
					{ name: 'test puzzle 2', url: 'test puzzle 2 url' },
				],
				round
			);
			round = puzzlehunt.getRound(round.id);
			expect(
				round.children.map((child) => ({
					name: child.name,
					url: child.url,
					roundId: child.roundId,
				}))
			).toEqual([
				{
					name: 'test puzzle 1',
					url: 'test puzzle 1 url',
					roundId: round.id,
				},
				{
					name: 'test puzzle 2',
					url: 'test puzzle 2 url',
					roundId: round.id,
				},
			]);
			expect(Array.from(puzzlehunt.puzzles)).toHaveLength(2);
		});
	});

	it('supports moving a puzzle to a new round', () => {
		let round1 = puzzlehunt.addRound('round 1', 'round 1 url');
		let round2 = puzzlehunt.addRound('round 2', 'round 2 url', round1);
		let puzzle = puzzlehunt.addPuzzle('test puzzle', 'test url', round1);
		puzzlehunt.move(puzzle, round2);
		round1 = puzzlehunt.getRound(round1.id);
		round2 = puzzlehunt.getRound(round2.id);
		puzzle = puzzlehunt.getPuzzle(puzzle.id);
		expect(round1.children).toHaveLength(1);
		expect(round2.children).toHaveLength(1);
		expect(round2.children[0].id).toEqual(puzzle.id);
		expect(puzzle.roundId).toEqual(round2.id);
	});

	it('supports puzzle deletion', () => {
		const round = puzzlehunt.addRound('root round', 'root url');
		const puzzle = puzzlehunt.addPuzzle('test puzzle', 'test url', round);
		puzzlehunt.delete(puzzle);
		expect(Array.from(puzzlehunt.puzzles)).toHaveLength(0);
	});

	describe('supports augmenting', () => {
		describe('a round', () => {
			let round: Round;
			beforeEach(() => {
				round = puzzlehunt.addRound('test round', 'test url');
			});

			it('with discord info', () => {
				expect(round.discordInfo).toEqual(undefined);
				puzzlehunt.augmentWithDiscord(round, {
					indexChannel: 'index channel id',
					channel: 'channel id',
					role: 'role id',
				});
				round = puzzlehunt.getRound(round.id);
				expect(round.discordInfo).toEqual({
					indexChannelId: 'index channel id',
					channelId: 'channel id',
					roleId: 'role id',
				});
			});

			it('with a new name', () => {
				puzzlehunt.changeName(round, 'new name');
				round = puzzlehunt.getRound(round.id);
				expect(round.name).toEqual('new name');
			});
		});

		describe('a puzzle', () => {
			let puzzle: Puzzle;
			beforeEach(() => {
				vi.spyOn(Date, 'now').mockImplementation(() => 42);
				const round = puzzlehunt.addRound('test round', 'test url');
				puzzle = puzzlehunt.addPuzzle(
					'test puzzle',
					'test puzzle url',
					round
				);
			});

			it('with discord info', () => {
				expect(puzzle.discordInfo).toEqual(undefined);
				puzzlehunt.augmentWithDiscord(puzzle, {
					channel: 'channel id',
					role: 'role id',
				});
				puzzle = puzzlehunt.getPuzzle(puzzle.id);
				expect(puzzle.discordInfo).toEqual({
					channelId: 'channel id',
					roleId: 'role id',
				});
			});

			it("with a google sheet's id", () => {
				puzzlehunt.augmentWithGoogleSheet(puzzle, 'google sheet id');
				puzzle = puzzlehunt.getPuzzle(puzzle.id);
				expect(puzzle.sheetId).toEqual('google sheet id');
			});

			it('with an answer', () => {
				puzzlehunt.solve(puzzle.id, 'test answer');
				puzzle = puzzlehunt.getPuzzle(puzzle.id);
				expect(puzzle.answer).toEqual('test answer');
			});

			it('with a status update', () => {
				puzzlehunt.updateStatus(puzzle, 'test status');
				puzzle = puzzlehunt.getPuzzle(puzzle.id);
				expect(puzzle.status).toEqual('test status');
				expect(puzzle.lastStatusUpdate).toEqual(42);
				puzzlehunt.clearStatus(puzzle);
				puzzle = puzzlehunt.getPuzzle(puzzle.id);
				expect(puzzle.status).toEqual(undefined);
				expect(puzzle.lastStatusUpdate).toEqual(undefined);
			});

			it('with a new name', () => {
				puzzlehunt.changeName(puzzle, 'new name');
				puzzle = puzzlehunt.getPuzzle(puzzle.id);
				expect(puzzle.name).toEqual('new name');
			});
		});
	});

	describe('raises backend-neutral changes', () => {
		it('reports reordering through positions and historical child order', () => {
			const round = puzzlehunt.addRound('Round', '');
			const puzzle = puzzlehunt.addPuzzle('First', '', round);
			puzzlehunt.addPuzzle('Second', '', round);
			const listener = vi.fn<(event: PuzzlehuntChangeEvent) => void>();
			puzzlehunt.subscribeChanges(listener);
			puzzlehunt.move(puzzle, round);
			expect(listener).toHaveBeenCalledOnce();
			const event = listener.mock.calls[0][0];
			expect(
				event.before.rounds[0].children.map((node) => node.name)
			).toEqual(['First', 'Second']);
			expect(
				event.after.rounds[0].children.map((node) => node.name)
			).toEqual(['Second', 'First']);
			expect(event.changes).toEqual([
				{
					type: 'node-changed',
					before: expect.objectContaining({
						name: 'First',
						position: 0,
					}),
					after: expect.objectContaining({
						name: 'First',
						position: 1,
					}),
				},
				{
					type: 'node-changed',
					before: expect.objectContaining({
						name: 'Second',
						position: 1,
					}),
					after: expect.objectContaining({
						name: 'Second',
						position: 0,
					}),
				},
			]);
		});

		it('accepts stable snapshots at integration mutation boundaries and retains old menu identities', () => {
			const round = puzzlehunt.addRound('Round', '');
			const puzzle = puzzlehunt.addPuzzle('Puzzle', '', round);
			const snapshot = puzzlehunt.view;
			expect(puzzlehunt.getPuzzle(snapshot.puzzles[0].id).id).toBe(
				puzzle.id
			);
			expect(puzzlehunt.getPuzzle(String(puzzle.id)).id).toBe(puzzle.id);
			expect(puzzlehunt.getRound(snapshot.rounds[0].id).id).toBe(
				round.id
			);
			puzzlehunt.augmentWithDiscord(snapshot.rounds[0], {
				channel: 'round-channel',
				role: 'round-role',
				indexChannel: 'index',
			});
			puzzlehunt.augmentWithDiscord(snapshot.puzzles[0], {
				channel: 'channel',
				role: 'role',
			});
			puzzlehunt.augmentWithGoogleSheet(snapshot.puzzles[0], 'sheet');
			expect(puzzlehunt.getPuzzle(puzzle.id).sheetId).toBe('sheet');
			expect(
				puzzlehunt.getRound(round.id).discordInfo.indexChannelId
			).toBe('index');
			expect(snapshot.puzzles[0].sheetId).toBeUndefined();
			expect(snapshot.rounds[0].discord).toBeUndefined();
		});

		it('batches Discord associations and retains removal values with stable IDs', () => {
			const round = puzzlehunt.addRound('Round', '');
			const puzzle = puzzlehunt.addPuzzle('Puzzle', '', round);
			const listener = vi.fn<(event: PuzzlehuntChangeEvent) => void>();
			puzzlehunt.subscribeChanges(listener);
			puzzlehunt.augmentWithDiscord(puzzle, {
				channel: 'channel',
				role: 'role',
			});
			expect(listener).toHaveBeenCalledOnce();
			const event = listener.mock.calls[0][0];
			const stableId = puzzlehunt.view.puzzles[0].id;
			expect(event.changes).toEqual([
				{
					type: 'node-changed',
					before: expect.objectContaining({
						id: stableId,
						name: 'Puzzle',
					}),
					after: expect.objectContaining({
						id: stableId,
						discord: { channelId: 'channel', roleId: 'role' },
					}),
				},
			]);
			const saved = JSON.stringify(event);
			puzzlehunt.delete(round);
			expect(listener.mock.calls[1][0].changes).toEqual(
				expect.arrayContaining([
					{
						type: 'node-removed',
						node: expect.objectContaining({
							id: stableId,
							discord: { channelId: 'channel', roleId: 'role' },
						}),
					},
				])
			);
			expect(JSON.stringify(event)).toBe(saved);
		});

		interface Delta<T> {
			added: T[];
			changed: T[];
			removed: T[];
		}
		function mapDelta<T, O>(delta: Delta<T>, f: (t: T) => O): Delta<O> {
			return {
				added: delta.added.map(f),
				changed: delta.changed.map(f),
				removed: delta.removed.map(f),
			};
		}

		function filterDelta<T, SubT extends T>(
			delta: Delta<T>,
			f: (t: T) => t is SubT
		): Delta<SubT> {
			return {
				added: delta.added.filter(f),
				changed: delta.changed.filter(f),
				removed: delta.removed.filter(f),
			};
		}

		type TreeNode = DocumentNode;

		function spyOnPuzzlehunt(puzzlehunt: IPuzzlehunt): Delta<TreeNode>[] {
			const deltas: Delta<TreeNode>[] = [];
			puzzlehunt.subscribeChanges(({ changes }) => {
				deltas.push({
					added: changes.flatMap((change) =>
						change.type === 'node-added' ? [change.node] : []
					),
					removed: changes.flatMap((change) =>
						change.type === 'node-removed' ? [change.node] : []
					),
					changed: changes.flatMap((change) =>
						change.type === 'node-changed' ? [change.after] : []
					),
				});
			});
			return deltas;
		}

		it('on round addition', () => {
			const deltas = spyOnPuzzlehunt(puzzlehunt);
			puzzlehunt.addRound('test round', 'test url');
			expect(deltas).toHaveLength(1);
			const [delta] = deltas;
			const changedRounds = filterDelta(
				delta,
				(id): id is DocumentRound => id?.type === 'round'
			);
			expect(mapDelta(changedRounds, (round) => round.name)).toEqual({
				added: ['test round'],
				changed: [],
				removed: [],
			});
		});

		it('on round deletion', () => {
			const round = puzzlehunt.addRound('test round', 'test url');
			const deltas = spyOnPuzzlehunt(puzzlehunt);
			puzzlehunt.delete(round);
			expect(deltas).toHaveLength(1);
			const [delta] = deltas;
			const changedRounds = filterDelta(
				delta,
				(id): id is DocumentRound => id?.type === 'round'
			);
			expect(mapDelta(changedRounds, (round) => round.name)).toEqual({
				added: [],
				changed: [],
				removed: ['test round'],
			});
		});

		it('on puzzle addition', () => {
			const round = puzzlehunt.addRound('test round', 'test url');
			const deltas = spyOnPuzzlehunt(puzzlehunt);
			puzzlehunt.addPuzzle('test puzzle', 'url 1', round);
			expect(deltas).toHaveLength(1);
			const [delta] = deltas;
			const changedRounds = filterDelta(
				delta,
				(id): id is DocumentPuzzle => id?.type === 'puzzle'
			);
			expect(mapDelta(changedRounds, (puzzle) => puzzle.name)).toEqual({
				added: ['test puzzle'],
				changed: [],
				removed: [],
			});
		});

		it('on puzzle move', () => {
			const round1 = puzzlehunt.addRound('test round', 'test url');
			const round2 = puzzlehunt.addRound(
				'test round 2',
				'round 2 url',
				round1
			);
			const puzzle = puzzlehunt.addPuzzle('test puzzle', 'url 1', round1);
			const deltas = spyOnPuzzlehunt(puzzlehunt);
			puzzlehunt.move(puzzle, round2);
			expect(deltas).toHaveLength(1);
			const [delta] = deltas;
			const changedRounds = filterDelta(delta, (id): id is DocumentNode =>
				['puzzle', 'round'].includes(id?.type)
			);
			expect(mapDelta(changedRounds, (puzzle) => puzzle.name)).toEqual({
				added: [],
				changed: ['test puzzle'],
				removed: [],
			});
		});

		it('on puzzle deletion', () => {
			const round = puzzlehunt.addRound('test round', 'test url');
			const puzzle = puzzlehunt.addPuzzle('test puzzle', 'url 1', round);
			const deltas = spyOnPuzzlehunt(puzzlehunt);
			puzzlehunt.delete(puzzle);
			expect(deltas).toHaveLength(1);
			const [delta] = deltas;
			const changedRounds = filterDelta(
				delta,
				(id): id is DocumentPuzzle => id?.type === 'puzzle'
			);
			expect(mapDelta(changedRounds, (puzzle) => puzzle.name)).toEqual({
				added: [],
				changed: [],
				removed: ['test puzzle'],
			});
		});
	});
});

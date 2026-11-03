import { describe, expect, it } from 'vitest';
import {
	applyHuntCommand,
	assertHuntDocument,
	documentChildren,
	projectHuntDocument,
} from '../document.js';
import type { HuntCommand, HuntDocument, HuntSnapshot } from '../document.js';

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const rootId = id(1);
const puzzleId = id(2);
const nestedId = id(3);
const apply = (document: HuntDocument, command: HuntCommand) =>
	applyHuntCommand(document, command, 1234);

function seed(): HuntDocument {
	return apply(
		{ nodes: {} },
		{
			type: 'add',
			nodes: [
				{
					id: rootId,
					type: 'round',
					name: 'Root',
					url: '',
					parentId: null,
				},
				{
					id: puzzleId,
					type: 'puzzle',
					name: 'Puzzle',
					url: '',
					parentId: rootId,
				},
				{
					id: nestedId,
					type: 'round',
					name: 'Nested',
					url: '',
					parentId: rootId,
				},
			],
		}
	).document;
}

describe('database document commands', () => {
	it('preserves independent adds and field assignments applied to fresh state', () => {
		const original = seed();
		const first = apply(original, {
			type: 'add',
			nodes: [
				{
					id: id(4),
					type: 'puzzle',
					name: 'A',
					url: '',
					parentId: rootId,
				},
			],
		}).document;
		const second = apply(first, {
			type: 'add',
			nodes: [
				{
					id: id(5),
					type: 'puzzle',
					name: 'B',
					url: '',
					parentId: rootId,
				},
			],
		}).document;
		const renamed = apply(second, {
			type: 'rename',
			nodeId: puzzleId,
			name: 'Renamed',
		}).document;
		const linked = apply(renamed, {
			type: 'set-url',
			nodeId: puzzleId,
			url: 'https://example.com',
		}).document;
		expect(
			documentChildren(linked, rootId).map((node) => node.name)
		).toEqual(['Renamed', 'Nested', 'A', 'B']);
		expect(linked.nodes[puzzleId].url).toBe('https://example.com');
		expect(original.nodes[puzzleId].name).toBe('Puzzle');
		expect(Object.keys(original.nodes)).toHaveLength(3);
	});

	it('uses application order for solves, clears status atomically, and preserves unrelated fields', () => {
		const linked = apply(seed(), {
			type: 'set-sheet',
			nodeId: puzzleId,
			sheetId: 'sheet',
		}).document;
		const status = apply(linked, {
			type: 'set-status',
			nodeId: puzzleId,
			status: 'Working',
		});
		expect(status.document.nodes[puzzleId]).toMatchObject({
			status: 'Working',
			lastStatusUpdate: 1234,
		});
		const first = apply(status.document, {
			type: 'solve',
			nodeId: puzzleId,
			answer: 'FIRST',
		});
		const last = applyHuntCommand(
			first.document,
			{ type: 'solve', nodeId: puzzleId, answer: 'LAST' },
			1000
		);
		expect(last.document.nodes[puzzleId]).toMatchObject({
			answer: 'LAST',
			sheetId: 'sheet',
		});
		expect(last.document.nodes[puzzleId]).not.toHaveProperty('status');
		expect(last.document.nodes[puzzleId]).not.toHaveProperty(
			'lastStatusUpdate'
		);
		expect(first.events).toEqual([
			{ type: 'puzzle-solved', node: first.document.nodes[puzzleId] },
		]);
		expect(last.events).toHaveLength(1);
	});

	it('clears status/timestamp together and unsolves without removing a later status', () => {
		const solved = apply(seed(), {
			type: 'solve',
			nodeId: puzzleId,
			answer: 'ANSWER',
		}).document;
		const status = apply(solved, {
			type: 'set-status',
			nodeId: puzzleId,
			status: 'Rechecking',
		}).document;
		const unsolved = apply(status, { type: 'unsolve', nodeId: puzzleId });
		expect(unsolved.document.nodes[puzzleId]).not.toHaveProperty('answer');
		expect(unsolved.document.nodes[puzzleId]).toMatchObject({
			status: 'Rechecking',
			lastStatusUpdate: 1234,
		});
		expect(unsolved.events).toEqual([]);
		const cleared = apply(unsolved.document, {
			type: 'set-status',
			nodeId: puzzleId,
			status: null,
		});
		expect(cleared.document.nodes[puzzleId]).not.toHaveProperty('status');
		expect(cleared.document.nodes[puzzleId]).not.toHaveProperty(
			'lastStatusUpdate'
		);
		expect(cleared.events[0].type).toBe('puzzle-status-updated');
	});

	it('moves to the end of fresh siblings and treats moving to the same parent as no change', () => {
		const moved = apply(seed(), {
			type: 'move',
			nodeId: puzzleId,
			parentId: nestedId,
		}).document;
		expect(documentChildren(moved, rootId).map((node) => node.id)).toEqual([
			nestedId,
		]);
		expect(
			documentChildren(moved, nestedId).map((node) => node.id)
		).toEqual([puzzleId]);
		const same = apply(moved, {
			type: 'move',
			nodeId: puzzleId,
			parentId: nestedId,
		}).document;
		expect(same).toEqual(moved);
		const root = apply(moved, {
			type: 'move',
			nodeId: nestedId,
			parentId: null,
		}).document;
		expect(documentChildren(root, null).map((node) => node.id)).toEqual([
			rootId,
			nestedId,
		]);
	});

	it('captures recursive deletion tombstones including associations and retained sheets', () => {
		const linked = apply(seed(), {
			type: 'set-sheet',
			nodeId: puzzleId,
			sheetId: 'keep-this-sheet',
		}).document;
		const associated = applyHuntCommand(
			linked,
			{
				type: 'set-discord',
				nodeId: puzzleId,
				discord: { channelId: 'channel', roleId: 'role' },
			},
			1234
		).document;
		const deleted = apply(associated, { type: 'delete', nodeId: rootId });
		expect(deleted.document.nodes).toEqual({});
		expect(deleted.events).toHaveLength(3);
		expect(deleted.events).toContainEqual({
			type: 'node-deleted',
			node: expect.objectContaining({
				id: puzzleId,
				sheetId: 'keep-this-sheet',
				discord: { channelId: 'channel', roleId: 'role' },
			}),
		});
		expect(associated.nodes[puzzleId]).toBeDefined();
	});

	it('rejects cycles and missing/wrong-kind parents without changing the source', () => {
		const document = seed();
		expect(() =>
			apply(document, {
				type: 'move',
				nodeId: rootId,
				parentId: nestedId,
			})
		).toThrow(/cycles/);
		expect(() =>
			apply(document, {
				type: 'move',
				nodeId: nestedId,
				parentId: puzzleId,
			})
		).toThrow(/parent must be a round/);
		expect(() =>
			apply(document, { type: 'move', nodeId: puzzleId, parentId: id(9) })
		).toThrow(/does not exist/);
		expect(() =>
			apply(document, { type: 'solve', nodeId: rootId, answer: 'x' })
		).toThrow(/requires a puzzle/);
		expect(() =>
			apply(document, { type: 'solve', nodeId: puzzleId, answer: '' })
		).toThrow(/requires an answer/);
		expect(document).toEqual(seed());
	});

	it('rejects an invalid batch as a whole and never overwrites an existing identity', () => {
		const document = seed();
		expect(() =>
			apply(document, {
				type: 'add',
				nodes: [
					{
						id: id(4),
						type: 'round',
						name: 'New',
						url: '',
						parentId: null,
					},
					{
						id: rootId,
						type: 'round',
						name: 'Replacement',
						url: '',
						parentId: null,
					},
				],
			})
		).toThrow(/already exists/);
		expect(Object.keys(document.nodes)).toHaveLength(3);
		expect(() =>
			apply(document, {
				type: 'add',
				nodes: [
					{
						id: '__proto__',
						type: 'round',
						name: 'Invalid',
						url: '',
						parentId: null,
					},
				],
			})
		).toThrow(/UUID/);
	});

	it('rejects incoherent timestamps and incomplete round associations', () => {
		const document = seed();
		const puzzle = document.nodes[puzzleId];
		expect(() =>
			assertHuntDocument({
				nodes: {
					...document.nodes,
					[puzzleId]: {
						...puzzle,
						type: 'puzzle',
						parentId: rootId,
						status: 'Missing clock',
					},
				},
			})
		).toThrow(/timestamp/);
		expect(() =>
			applyHuntCommand(
				document,
				{
					type: 'set-discord',
					nodeId: rootId,
					discord: { channelId: 'category', roleId: 'role' },
				},
				100
			)
		).toThrow(/Incomplete Discord/);
	});
});

describe('database document view', () => {
	it('projects nested children from a JSON snapshot without Fluid IDs or handles', () => {
		const snapshot: HuntSnapshot = {
			huntId: id(10),
			guildId: 'guild',
			schemaVersion: 1,
			revision: 3,
			name: 'Hunt',
			configuration: {},
			document: seed(),
		};
		const view = projectHuntDocument(JSON.parse(JSON.stringify(snapshot)));
		expect(view.rootRounds.map((round) => round.id)).toEqual([rootId]);
		expect(view.rounds.map((round) => round.id)).toEqual([
			rootId,
			nestedId,
		]);
		expect(view.puzzles.map((puzzle) => puzzle.id)).toEqual([puzzleId]);
		expect(view.childrenByRound[rootId].map((node) => node.id)).toEqual([
			puzzleId,
			nestedId,
		]);
		expect(view.childrenByRound[nestedId]).toEqual([]);
		expect(view.snapshot.revision).toBe(3);
	});
});

import { describe, expect, it } from 'vitest';
import {
	applyHuntCommand,
	validateHuntDocument,
	documentChildren,
	projectHuntDocument,
	snowflake,
} from '../document.js';
import type {
	DocumentNode,
	HuntCommand,
	HuntDocument,
	HuntSnapshot,
} from '../document.js';
import { projectPuzzlehuntView } from '../model/types.js';

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const rootId = id(1);
const puzzleId = id(2);
const nestedId = id(3);
const apply = (document: HuntDocument, command: HuntCommand) =>
	applyHuntCommand(document, command, 1234);

function seed(): HuntDocument {
	return apply(
		{ name: 'Hunt', configuration: {}, nodes: {} },
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
	it.each(['puzzle', 'round'] as const)(
		'leaves a %s in place when moved to its current parent',
		(type) => {
			const document = seed();
			const nodeId = type === 'puzzle' ? puzzleId : nestedId;
			const result = apply(document, {
				type: 'move',
				nodeId,
				parentId: rootId,
			});
			expect(result.document).toEqual(document);
			expect(result.events).toEqual([]);
		}
	);

	it('preserves document metadata when applying node commands', () => {
		const document = {
			...seed(),
			name: 'Named hunt',
			configuration: { googleFolderId: 'folder' },
		};
		const result = apply(document, { type: 'delete', nodeId: puzzleId });
		expect(result.document.name).toBe(document.name);
		expect(result.document.configuration).toEqual(document.configuration);
	});

	it.each([
		['answer', 'ANSWER'],
		['status', 'Working'],
		['lastStatusUpdate', 1234],
		['sheetId', 'sheet'],
		[
			'discord',
			{ channelId: snowflake('channel'), roleId: snowflake('role') },
		],
		['position', 0],
		['sheetId', undefined],
	] as const)('rejects %s supplied during creation %#', (property, value) => {
		const document = seed();
		expect(() =>
			apply(document, {
				type: 'add',
				nodes: [
					{
						id: id(4),
						type: 'puzzle',
						parentId: rootId,
						name: 'New',
						url: '',
						[property]: value,
					},
				],
			})
		).toThrow(/Create nodes before assigning/);
		expect(Object.keys(document.nodes)).toHaveLength(3);
	});

	it('allows a parent declared later in the same creation batch', () => {
		const document = apply(seed(), {
			type: 'add',
			nodes: [
				{
					id: id(4),
					type: 'puzzle',
					parentId: id(5),
					name: 'Child',
					url: '',
				},
				{
					id: id(5),
					type: 'round',
					parentId: null,
					name: 'Parent',
					url: '',
				},
			],
		}).document;
		expect(
			documentChildren(document, id(5)).map((node) => node.id)
		).toEqual([id(4)]);
	});

	it('rejects puzzle creation without a parent round', () => {
		expect(() =>
			apply(seed(), {
				type: 'add',
				nodes: [
					{
						id: id(4),
						type: 'puzzle',
						parentId: null,
						name: 'Root puzzle',
						url: '',
					},
				],
			})
		).toThrow(/Puzzles must have a parent round/);
	});

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
			type: 'set-property',
			property: 'name',
			nodeId: puzzleId,
			value: 'Renamed',
		}).document;
		const linked = apply(renamed, {
			type: 'set-property',
			property: 'url',
			nodeId: puzzleId,
			value: 'https://example.com',
		}).document;
		expect(
			documentChildren(linked, rootId).map((node) => node.name)
		).toEqual(['Renamed', 'Nested', 'A', 'B']);
		expect(linked.nodes[puzzleId].url).toBe('https://example.com');
		expect(original.nodes[puzzleId].name).toBe('Puzzle');
		expect(Object.keys(original.nodes)).toHaveLength(3);
	});

	describe('document graph validation', () => {
		it.each(['round', 'puzzle'] as const)(
			'rejects dangling %s parents',
			(type) => {
				const document = seed();
				const nodeId = type === 'round' ? nestedId : puzzleId;
				expect(() =>
					validateHuntDocument({
						...document,
						nodes: {
							...document.nodes,
							[nodeId]: {
								...document.nodes[nodeId],
								parentId: id(99),
							},
						},
					})
				).toThrow(/does not exist/);
			}
		);

		it('rejects a round whose parent is a puzzle', () => {
			const document = seed();
			expect(() =>
				validateHuntDocument({
					...document,
					nodes: {
						...document.nodes,
						[nestedId]: {
							...document.nodes[nestedId],
							parentId: puzzleId,
						},
					},
				})
			).toThrow(/Parent must be a round/);
		});

		it('rejects a cycle in an assembled document', () => {
			const document = seed();
			expect(() =>
				validateHuntDocument({
					...document,
					nodes: {
						...document.nodes,
						[rootId]: {
							...document.nodes[rootId],
							parentId: nestedId,
						},
					},
				})
			).toThrow(/cycles/);
		});

		it('rejects duplicate sibling positions', () => {
			const document = seed();
			expect(() =>
				validateHuntDocument({
					...document,
					nodes: {
						...document.nodes,
						[nestedId]: {
							...document.nodes[nestedId],
							position: document.nodes[puzzleId].position,
						},
					},
				})
			).toThrow(/positions must be unique/);
		});
	});

	function measuredDocument(nodes: Record<string, DocumentNode>) {
		let parentReads = 0;
		const measured: Record<string, DocumentNode> = {};
		for (const [id, node] of Object.entries(nodes)) {
			measured[id] = new Proxy(node, {
				get(target, property, receiver) {
					if (property === 'parentId') parentReads++;
					return Reflect.get(target, property, receiver);
				},
			});
		}
		return {
			document: { name: 'Hunt', configuration: {}, nodes: measured },
			parentReads: () => parentReads,
		};
	}

	function roundChain(count: number): Record<string, DocumentNode> {
		const nodes: Record<string, DocumentNode> = {};
		for (let index = 1; index <= count; index++) {
			nodes[id(index)] = {
				id: id(index),
				type: 'round',
				name: 'Round',
				url: '',
				parentId: index === 1 ? null : id(index - 1),
				position: 0,
			};
		}
		return nodes;
	}

	describe('indexed document operations', () => {
		it('validates a deep ancestry chain with linear parent lookups and no recursion', () => {
			const count = 12000;
			const measured = measuredDocument(roundChain(count));
			validateHuntDocument(measured.document);
			expect(measured.parentReads()).toBeLessThanOrEqual(4 * count);
		});

		it('deletes a deep subtree with linear parent lookups and no recursion', () => {
			const count = 12000;
			const measured = measuredDocument(roundChain(count));
			const result = apply(measured.document, {
				type: 'delete',
				nodeId: id(1),
			});
			expect(Object.keys(result.document.nodes)).toHaveLength(0);
			expect(result.events).toHaveLength(count);
			expect(measured.parentReads()).toBeLessThanOrEqual(4 * count);
		});

		it('allocates bulk sibling positions without rescanning existing nodes per addition', () => {
			const count = 1000;
			const measured = measuredDocument(roundChain(count));
			const result = apply(measured.document, {
				type: 'add',
				nodes: Array.from({ length: count }, (_, index) => ({
					id: id(count + index + 1),
					type: 'puzzle',
					parentId: id(1),
					name: 'Added',
					url: '',
				})),
			});
			expect(Object.keys(result.document.nodes)).toHaveLength(2 * count);
			expect(result.document.nodes[id(2 * count)].position).toBe(count);
			expect(measured.parentReads()).toBeLessThanOrEqual(10 * count);
		});

		it('preserves last-sibling-first subtree deletion event order', () => {
			expect(
				apply(seed(), { type: 'delete', nodeId: rootId }).events.map(
					({ node }) => node.id
				)
			).toEqual([rootId, nestedId, puzzleId]);
		});
	});

	it('uses application order for solves, clears status atomically, and preserves unrelated fields', () => {
		const linked = apply(seed(), {
			type: 'set-property',
			property: 'sheetId',
			nodeId: puzzleId,
			value: 'sheet',
		}).document;
		const status = apply(linked, {
			type: 'set-property',
			property: 'status',
			nodeId: puzzleId,
			value: 'Working',
		});
		expect(status.document.nodes[puzzleId]).toMatchObject({
			status: 'Working',
			lastStatusUpdate: 1234,
		});
		const first = apply(status.document, {
			type: 'set-property',
			property: 'answer',
			nodeId: puzzleId,
			value: 'FIRST',
		});
		const last = applyHuntCommand(
			first.document,
			{
				type: 'set-property',
				property: 'answer',
				nodeId: puzzleId,
				value: 'LAST',
			},
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
			type: 'set-property',
			property: 'answer',
			nodeId: puzzleId,
			value: 'ANSWER',
		}).document;
		const status = apply(solved, {
			type: 'set-property',
			property: 'status',
			nodeId: puzzleId,
			value: 'Rechecking',
		}).document;
		const unsolved = apply(status, {
			type: 'set-property',
			property: 'answer',
			value: null,
			nodeId: puzzleId,
		});
		expect(unsolved.document.nodes[puzzleId]).not.toHaveProperty('answer');
		expect(unsolved.document.nodes[puzzleId]).toMatchObject({
			status: 'Rechecking',
			lastStatusUpdate: 1234,
		});
		expect(unsolved.events).toEqual([]);
		const cleared = apply(unsolved.document, {
			type: 'set-property',
			property: 'status',
			nodeId: puzzleId,
			value: null,
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
			type: 'set-property',
			property: 'sheetId',
			nodeId: puzzleId,
			value: 'keep-this-sheet',
		}).document;
		const associated = applyHuntCommand(
			linked,
			{
				type: 'set-property',
				property: 'discord',
				nodeId: puzzleId,
				value: {
					channelId: snowflake('channel'),
					roleId: snowflake('role'),
				},
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
				discord: {
					channelId: snowflake('channel'),
					roleId: snowflake('role'),
				},
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
		).toThrow(/Parent must be a round/);
		expect(() =>
			apply(document, { type: 'move', nodeId: puzzleId, parentId: id(9) })
		).toThrow(/does not exist/);
		expect(() =>
			apply(document, {
				type: 'set-property',
				property: 'answer',
				nodeId: rootId,
				value: 'x',
			})
		).toThrow(/requires a puzzle/);
		expect(() =>
			apply(document, {
				type: 'set-property',
				property: 'answer',
				nodeId: puzzleId,
				value: '',
			})
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

	it('rejects incoherent timestamps and invalid Discord associations', () => {
		const document = seed();
		const puzzle = document.nodes[puzzleId];
		expect(() =>
			validateHuntDocument({
				...document,
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
					type: 'set-property',
					property: 'discord',
					nodeId: rootId,
					value: {
						channelId: snowflake('category'),
						roleId: snowflake('role'),
					},
				},
				100
			)
		).toThrow(/Invalid Discord/);
		expect(() =>
			applyHuntCommand(
				document,
				{
					type: 'set-property',
					property: 'discord',
					nodeId: puzzleId,
					value: {
						channelId: snowflake('channel'),
						roleId: snowflake('role'),
						indexChannelId: snowflake('index'),
					},
				},
				100
			)
		).toThrow(/Invalid Discord/);
	});
});

describe('database document view', () => {
	it.each([
		projectHuntDocument,
		(snapshot: HuntSnapshot) => projectPuzzlehuntView(snapshot.document),
	])(
		'indexes children without scanning the entire document per round %#',
		(project) => {
			const nodes: Record<string, HuntDocument['nodes'][string]> = {};
			for (let index = 1; index <= 100; index++) {
				const roundId = id(index);
				nodes[roundId] = {
					id: roundId,
					type: 'round',
					name: 'Round',
					url: '',
					parentId: null,
					position: index,
				};
				const childId = id(index + 100);
				nodes[childId] = {
					id: childId,
					type: 'puzzle',
					name: 'Puzzle',
					url: '',
					parentId: roundId,
					position: 0,
				};
			}
			let scans = 0;
			const indexedNodes = new Proxy(nodes, {
				ownKeys(target) {
					scans++;
					return Reflect.ownKeys(target);
				},
			});
			const view = project({
				huntId: id(1000),
				guildId: snowflake('guild'),
				schemaVersion: 1,
				revision: 1,
				document: {
					name: 'Hunt',
					configuration: {},
					nodes: indexedNodes,
				},
			});
			expect(view.rounds).toHaveLength(100);
			expect(view.puzzles).toHaveLength(100);
			expect(scans).toBeLessThanOrEqual(2);
		}
	);

	it('projects nested children from a JSON snapshot without Fluid IDs or handles', () => {
		const snapshot: HuntSnapshot = {
			huntId: id(10),
			guildId: snowflake('guild'),
			schemaVersion: 1,
			revision: 3,
			document: seed(),
		};
		const view = projectHuntDocument(JSON.parse(JSON.stringify(snapshot)));
		expect(view.rootRounds.map((round) => round.id)).toEqual([rootId]);
		expect(view.rounds.map((round) => round.id)).toEqual([
			rootId,
			nestedId,
		]);
		expect(view.puzzles.map((puzzle) => puzzle.id)).toEqual([puzzleId]);
		expect(
			view.childrenIndex.childrenOf(rootId).map((node) => node.id)
		).toEqual([puzzleId, nestedId]);
		expect(view.childrenIndex.childrenOf(nestedId)).toEqual([]);
		expect(view.snapshot.revision).toBe(3);
	});
});

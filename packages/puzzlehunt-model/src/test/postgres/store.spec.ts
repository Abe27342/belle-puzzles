import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgresPuzzlehuntStore } from '../../postgres/store.js';
import type { HuntDatabasePool } from '../../postgres/store.js';
import type {
	HuntCommand,
	HuntScope,
} from '../../document.js';
import {
	assertHuntDocument,
	projectHuntDocument,
} from '../../document.js';

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope: HuntScope = { huntId: id(1), guildId: 'guild' };
const rootId = id(10);
const puzzleId = id(11);
let database: PGlite;
let store: PostgresPuzzlehuntStore;
let failEventInsert = false;

// PGlite has one connection. Queue leases just as a size-one pg Pool would;
// real multi-connection row-lock contention still needs a PostgreSQL service test.
function singleConnectionPool(): HuntDatabasePool {
	let tail = Promise.resolve();
	return {
		async connect() {
			const previous = tail;
			let release: () => void;
			tail = new Promise<void>((resolve) => {
				release = resolve;
			});
			await previous;
			return {
				async query<Row extends Record<string, unknown>>(
					text: string,
					values?: unknown[]
				) {
					if (
						failEventInsert &&
						text.includes('INSERT INTO integration_events')
					) {
						return database.query<Row>('SELECT 1 / 0');
					}
					return database.query<Row>(text, values);
				},
				release: () => release(),
			};
		},
	};
}

const submit = (commandId: number, command: HuntCommand) =>
	store.submit(scope, { commandId: id(commandId), command });

async function seed() {
	await submit(100, {
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
		],
	});
}

beforeAll(async () => {
	database = new PGlite();
	const schema = await readFile(
		new URL('../../postgres/schema.sql', import.meta.url),
		'utf8'
	);
	await database.exec(schema);
}, 30000);

beforeEach(async () => {
	await database.exec('TRUNCATE hunts CASCADE');
	await database.query(
		`INSERT INTO hunts (id, guild_id, name, schema_version) VALUES ($1, $2, 'Hunt', 1)`,
		[scope.huntId, scope.guildId]
	);
	failEventInsert = false;
	store = new PostgresPuzzlehuntStore(singleConnectionPool());
});

afterAll(async () => {
	await database?.close();
});

describe('PostgreSQL hunt store', () => {
	it('commits overlapping adds and independent assignments without replacing stale documents', async () => {
		await seed();
		await Promise.all([
			submit(101, {
				type: 'add',
				nodes: [
					{
						id: id(12),
						type: 'puzzle',
						name: 'A',
						url: '',
						parentId: rootId,
					},
				],
			}),
			submit(102, {
				type: 'add',
				nodes: [
					{
						id: id(13),
						type: 'puzzle',
						name: 'B',
						url: '',
						parentId: rootId,
					},
				],
			}),
		]);
		await Promise.all([
			submit(103, { type: 'rename', nodeId: puzzleId, name: 'Renamed' }),
			submit(104, {
				type: 'set-url',
				nodeId: puzzleId,
				url: 'https://example.com',
			}),
		]);
		const current = await store.read(scope);
		expect(current.revision).toBe(5);
		expect(Object.keys(current.document.nodes)).toHaveLength(4);
		expect(current.document.nodes[puzzleId]).toMatchObject({
			name: 'Renamed',
			url: 'https://example.com',
		});
		const { rows } = await database.query<{ requested_revision: number }>(
			'SELECT * FROM integration_jobs ORDER BY target'
		);
		expect(rows).toHaveLength(2);
		expect(rows.every((row) => row.requested_revision === 5)).toBe(true);
	});

	it('does not reapply a retry after a newer solve, including after reconstructing the store', async () => {
		await seed();
		await submit(101, {
			type: 'set-status',
			nodeId: puzzleId,
			status: 'Working',
		});
		const first = await submit(102, {
			type: 'solve',
			nodeId: puzzleId,
			answer: 'FIRST',
		});
		await submit(103, { type: 'solve', nodeId: puzzleId, answer: 'LAST' });
		store = new PostgresPuzzlehuntStore(singleConnectionPool());
		const retried = await submit(102, {
			type: 'solve',
			nodeId: puzzleId,
			answer: 'FIRST',
		});
		expect(retried.replayed).toBe(true);
		expect(retried.receipt).toEqual(first.receipt);
		expect(retried.snapshot.revision).toBe(4);
		expect(retried.snapshot.document.nodes[puzzleId]).toMatchObject({
			answer: 'LAST',
		});
		expect(retried.snapshot.document.nodes[puzzleId]).not.toHaveProperty(
			'status'
		);
		expect(retried.snapshot.document.nodes[puzzleId]).not.toHaveProperty(
			'lastStatusUpdate'
		);
		const { rows } = await database.query<{
			payload: { event: { type: string } };
		}>('SELECT payload FROM integration_events');
		expect(
			rows.filter((row) => row.payload.event.type === 'puzzle-solved')
		).toHaveLength(2);
	});

	it('deduplicates equivalent JSON command objects but rejects key reuse for a different intent', async () => {
		await seed();
		await submit(101, { type: 'rename', nodeId: puzzleId, name: 'New' });
		const retry = await submit(101, {
			name: 'New',
			nodeId: puzzleId,
			type: 'rename',
		});
		expect(retry.replayed).toBe(true);
		await expect(
			submit(101, { type: 'rename', nodeId: puzzleId, name: 'Different' })
		).rejects.toMatchObject({ code: 'conflict' });
		expect((await store.read(scope)).revision).toBe(2);
	});

	it('rolls back document, receipt, and queued work when durable event recording fails', async () => {
		failEventInsert = true;
		await expect(seed()).rejects.toThrow('division by zero');
		failEventInsert = false;
		expect((await store.read(scope)).revision).toBe(0);
		expect((await store.read(scope)).document.nodes).toEqual({});
		for (const table of [
			'hunt_nodes',
			'command_receipts',
			'integration_jobs',
			'integration_events',
		]) {
			const { rows } = await database.query(`SELECT * FROM ${table}`);
			expect(rows).toEqual([]);
		}
		await seed();
		expect((await store.read(scope)).revision).toBe(1);
	});

	it('conditionally acknowledges only the exact pending generation and integration', async () => {
		await seed();
		await submit(101, { type: 'rename', nodeId: puzzleId, name: 'Newer' });
		expect(await store.acknowledgeReconciliation(scope, 'discord', 1)).toBe(
			false
		);
		expect(await store.acknowledgeReconciliation(scope, 'discord', 2)).toBe(
			true
		);
		const { rows } = await database.query(
			'SELECT target, requested_revision FROM integration_jobs'
		);
		expect(rows).toEqual([{ target: 'google', requested_revision: 2 }]);
		await submit(102, {
			type: 'set-url',
			nodeId: puzzleId,
			url: 'new-url',
		});
		expect(await store.acknowledgeReconciliation(scope, 'google', 2)).toBe(
			false
		);
		expect(await store.acknowledgeReconciliation(scope, 'google', 3)).toBe(
			true
		);
	});

	it('enforces hunt/guild ownership and preserves durable deletion snapshots', async () => {
		await seed();
		const wrongScope = { ...scope, guildId: 'other-guild' };
		await expect(store.read(wrongScope)).rejects.toMatchObject({
			code: 'not-found',
		});
		await expect(
			store.submit(wrongScope, {
				commandId: id(101),
				command: { type: 'delete', nodeId: rootId },
			})
		).rejects.toMatchObject({ code: 'not-found' });
		expect(
			await store.acknowledgeReconciliation(wrongScope, 'discord', 1)
		).toBe(false);
		await expect(
			database.query(
				'INSERT INTO active_hunts (guild_id, hunt_id) VALUES ($1, $2)',
				['other-guild', scope.huntId]
			)
		).rejects.toThrow();
		await store.submitIntegration(scope, id(102), {
			type: 'set-discord',
			nodeId: puzzleId,
			discord: { channelId: 'channel', roleId: 'role' },
		});
		await submit(103, { type: 'delete', nodeId: rootId });
		expect((await store.read(scope)).document.nodes).toEqual({});
		const { rows } = await database.query<{
			payload: { event: { node: { discord?: { channelId: string } } } };
		}>(
			`SELECT payload FROM integration_events WHERE payload->'event'->>'type' = 'node-deleted'`
		);
		expect(rows).toHaveLength(2);
		expect(
			rows.some(
				(row) => row.payload.event.node.discord?.channelId === 'channel'
			)
		).toBe(true);
	});

	it('does not retain reservations for deleted node IDs', async () => {
		await seed();
		await submit(101, { type: 'delete', nodeId: rootId });
		const result = await submit(102, {
			type: 'add',
			nodes: [
				{
					id: rootId,
					type: 'round',
					name: 'New round',
					url: '',
					parentId: null,
				},
			],
		});
		expect(result.snapshot.document.nodes[rootId].name).toBe('New round');
		expect(result.snapshot.revision).toBe(3);
	});

	it('assigns a database status timestamp rather than accepting a client clock', async () => {
		await seed();
		const result = await submit(101, {
			type: 'set-status',
			nodeId: puzzleId,
			status: 'Working',
		});
		const node = result.snapshot.document.nodes[puzzleId];
		expect(node.type).toBe('puzzle');
		if (node.type !== 'puzzle') {
			throw new Error('Expected a puzzle');
		}
		expect(Number.isSafeInteger(node.lastStatusUpdate)).toBe(true);
		expect(node.lastStatusUpdate).toBeGreaterThan(0);
		expect(node.status).toBe('Working');
	});

	it('round-trips normalized properties into the existing snapshot and view shapes', async () => {
		await seed();
		await submit(101, {
			type: 'add',
			nodes: [
				{
					id: id(12),
					type: 'round',
					name: 'Nested',
					url: '',
					parentId: rootId,
				},
				{
					id: id(13),
					type: 'puzzle',
					name: 'Nested puzzle',
					url: '',
					parentId: id(12),
				},
			],
		});
		await submit(102, {
			type: 'set-sheet',
			nodeId: puzzleId,
			sheetId: 'sheet',
		});
		await submit(103, {
			type: 'solve',
			nodeId: puzzleId,
			answer: 'ANSWER',
		});
		await submit(104, {
			type: 'set-status',
			nodeId: puzzleId,
			status: 'Rechecking',
		});
		await store.submitIntegration(scope, id(105), {
			type: 'set-discord',
			nodeId: puzzleId,
			discord: { channelId: 'puzzle-channel', roleId: 'puzzle-role' },
		});
		const committed = await store.submitIntegration(scope, id(106), {
			type: 'set-discord',
			nodeId: rootId,
			discord: {
				channelId: 'category',
				roleId: 'round-role',
				indexChannelId: 'index',
			},
		});
		const snapshot = await store.read(scope);
		expect(snapshot).toEqual(committed.snapshot);
		expect(snapshot.document.nodes[puzzleId]).toMatchObject({
			answer: 'ANSWER',
			status: 'Rechecking',
			sheetId: 'sheet',
			discord: { channelId: 'puzzle-channel', roleId: 'puzzle-role' },
		});
		const view = projectHuntDocument(snapshot);
		expect(view.rootRounds.map((node) => node.id)).toEqual([rootId]);
		expect(view.childrenByRound[rootId].map((node) => node.id)).toEqual([
			puzzleId,
			id(12),
		]);
		expect(view.childrenByRound[id(12)].map((node) => node.id)).toEqual([
			id(13),
		]);
		const { rows } = await database.query(
			`SELECT type, parent_id, answer, status, sheet_id, discord_channel_id
			 FROM hunt_nodes WHERE hunt_id = $1 AND id = $2`,
			[scope.huntId, puzzleId]
		);
		expect(rows).toEqual([
			{
				type: 'puzzle',
				parent_id: rootId,
				answer: 'ANSWER',
				status: 'Rechecking',
				sheet_id: 'sheet',
				discord_channel_id: 'puzzle-channel',
			},
		]);
		await submit(107, {
			type: 'set-sheet',
			nodeId: puzzleId,
			sheetId: null,
		});
		await submit(108, {
			type: 'set-status',
			nodeId: puzzleId,
			status: null,
		});
		await submit(109, { type: 'unsolve', nodeId: puzzleId });
		const cleared = await store.submitIntegration(scope, id(110), {
			type: 'set-discord',
			nodeId: puzzleId,
			discord: null,
		});
		const reread = await store.read(scope);
		expect(reread).toEqual(cleared.snapshot);
		expect(reread.document.nodes[puzzleId]).toEqual({
			id: puzzleId,
			type: 'puzzle',
			name: 'Puzzle',
			url: '',
			parentId: rootId,
			position: 0,
		});
	});

	it('updates only changed node rows', async () => {
		await seed();
		const versions = async () =>
			(
				await database.query<{ id: string; version: string }>(
					`SELECT id, xmin::text AS version FROM hunt_nodes WHERE hunt_id = $1 ORDER BY id`,
					[scope.huntId]
				)
			).rows;
		const before = await versions();
		await submit(101, {
			type: 'rename',
			nodeId: puzzleId,
			name: 'Changed',
		});
		const after = await versions();
		expect(after[0]).toEqual(before[0]);
		expect(after[1].version).not.toBe(before[1].version);
	});

	it('rejects a competing reparenting command that would create a cycle', async () => {
		await seed();
		await submit(101, {
			type: 'add',
			nodes: [
				{
					id: id(12),
					type: 'round',
					name: 'Other',
					url: '',
					parentId: null,
				},
			],
		});
		const results = await Promise.allSettled([
			submit(102, { type: 'move', nodeId: rootId, parentId: id(12) }),
			submit(103, { type: 'move', nodeId: id(12), parentId: rootId }),
		]);
		expect(results.map((result) => result.status)).toEqual([
			'fulfilled',
			'rejected',
		]);
		if (results[1].status !== 'rejected') {
			throw new Error('Expected the competing move to fail.');
		}
		expect(results[1].reason).toMatchObject({ code: 'invalid-command' });
		const snapshot = await store.read(scope);
		expect(snapshot.revision).toBe(3);
		expect(snapshot.document.nodes[rootId].parentId).toBe(id(12));
		expect(snapshot.document.nodes[id(12)].parentId).toBeNull();
		assertHuntDocument(snapshot.document);
	});
});

describe('normalized puzzlehunt schema', () => {
	it.each([
		{
			name: 'unknown node types',
			assignment: "type = 'unknown'",
			nodeId: puzzleId,
			code: '23514',
		},
		{
			name: 'missing names',
			assignment: 'name = NULL',
			nodeId: puzzleId,
			code: '23502',
		},
		{
			name: 'puzzles without parents',
			assignment: 'parent_id = NULL',
			nodeId: puzzleId,
			code: '23514',
		},
		{
			name: 'puzzle parents',
			assignment: `parent_id = '${puzzleId}'`,
			nodeId: rootId,
			code: '23503',
		},
		{
			name: 'missing parents',
			assignment: `parent_id = '${id(999)}'`,
			nodeId: puzzleId,
			code: '23503',
		},
		{
			name: 'self-parenting',
			assignment: `parent_id = '${rootId}'`,
			nodeId: rootId,
			code: '23514',
		},
		{
			name: 'negative positions',
			assignment: 'position = -1',
			nodeId: puzzleId,
			code: '23514',
		},
		{
			name: 'unsafe positions',
			assignment: 'position = 9007199254740992',
			nodeId: puzzleId,
			code: '23514',
		},
		{
			name: 'round answers',
			assignment: "answer = 'ANSWER'",
			nodeId: rootId,
			code: '23514',
		},
		{
			name: 'round sheets',
			assignment: "sheet_id = 'sheet'",
			nodeId: rootId,
			code: '23514',
		},
		{
			name: 'round statuses',
			assignment: "status = 'Working', last_status_update = 12",
			nodeId: rootId,
			code: '23514',
		},
		{
			name: 'status without a timestamp',
			assignment: "status = 'Working'",
			nodeId: puzzleId,
			code: '23514',
		},
		{
			name: 'timestamp without status',
			assignment: 'last_status_update = 12',
			nodeId: puzzleId,
			code: '23514',
		},
		{
			name: 'negative timestamps',
			assignment: "status = 'Working', last_status_update = -1",
			nodeId: puzzleId,
			code: '23514',
		},
		{
			name: 'unsafe timestamps',
			assignment:
				"status = 'Working', last_status_update = 9007199254740992",
			nodeId: puzzleId,
			code: '23514',
		},
		{
			name: 'partial Discord associations',
			assignment: "discord_channel_id = 'channel'",
			nodeId: puzzleId,
			code: '23514',
		},
		{
			name: 'round associations without an index',
			assignment:
				"discord_channel_id = 'category', discord_role_id = 'role'",
			nodeId: rootId,
			code: '23514',
		},
		{
			name: 'puzzle index channels',
			assignment:
				"discord_channel_id = 'channel', discord_role_id = 'role', discord_index_channel_id = 'index'",
			nodeId: puzzleId,
			code: '23514',
		},
	])(
		'rejects $name even for direct SQL writes',
		async ({ assignment, nodeId, code }) => {
			await seed();
			await expect(
				database.query(
					`UPDATE hunt_nodes SET ${assignment} WHERE hunt_id = $1 AND id = $2`,
					[scope.huntId, nodeId]
				)
			).rejects.toMatchObject({ code });
		}
	);

	it('rejects cross-hunt parent references', async () => {
		await seed();
		await database.query(
			`INSERT INTO hunts (id, guild_id, name, schema_version) VALUES ($1, 'other-guild', 'Other', 1)`,
			[id(2)]
		);
		await database.query(
			`INSERT INTO hunt_nodes (hunt_id, id, type, name, url, position)
			 VALUES ($1, $2, 'round', 'Other root', '', 0)`,
			[id(2), id(12)]
		);
		await expect(
			database.query(
				`UPDATE hunt_nodes SET parent_id = $3 WHERE hunt_id = $1 AND id = $2`,
				[scope.huntId, puzzleId, id(12)]
			)
		).rejects.toMatchObject({ code: '23503' });
	});

	it.each([
		{ name: 'root positions', nodeId: id(12), parentId: null, position: 0 },
		{
			name: 'child positions',
			nodeId: id(12),
			parentId: rootId,
			position: 0,
		},
		{ name: 'node IDs', nodeId: rootId, parentId: null, position: 9 },
	])('rejects duplicate $name', async ({ nodeId, parentId, position }) => {
		await seed();
		await expect(
			database.query(
				`INSERT INTO hunt_nodes (hunt_id, id, type, name, url, parent_id, position)
			 VALUES ($1, $2, 'round', 'New', '', $3, $4)`,
				[scope.huntId, nodeId, parentId, position]
			)
		).rejects.toMatchObject({ code: '23505' });
	});

	it('rejects invalid UUIDs and deleting a parent while children reference it', async () => {
		await seed();
		await expect(
			database.query(
				`INSERT INTO hunt_nodes (hunt_id, id, type, name, url, position)
			 VALUES ($1, 'not-a-uuid', 'round', 'Invalid', '', 9)`,
				[scope.huntId]
			)
		).rejects.toMatchObject({ code: '22P02' });
		await expect(
			database.query(
				`DELETE FROM hunt_nodes WHERE hunt_id = $1 AND id = $2`,
				[scope.huntId, rootId]
			)
		).rejects.toMatchObject({ code: '23503' });
	});

	it('preserves the safe integer upper bound when reading bigint properties', async () => {
		await seed();
		await database.query(
			`UPDATE hunt_nodes SET position = 9007199254740991,
			 status = 'Working', last_status_update = 9007199254740991
			 WHERE hunt_id = $1 AND id = $2`,
			[scope.huntId, puzzleId]
		);
		const node = (await store.read(scope)).document.nodes[puzzleId];
		expect(node.position).toBe(Number.MAX_SAFE_INTEGER);
		if (node.type !== 'puzzle') {
			throw new Error('Expected a puzzle.');
		}
		expect(node.lastStatusUpdate).toBe(Number.MAX_SAFE_INTEGER);
	});
});

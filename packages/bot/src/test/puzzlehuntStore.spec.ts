import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgresPuzzlehuntStore } from '../database/puzzlehuntStore.js';
import type { HuntDatabasePool } from '../database/puzzlehuntStore.js';
import type {
	HuntCommand,
	HuntScope,
} from '@belle-puzzles/puzzlehunt-model/document';

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
		new URL('../database/schema.sql', import.meta.url),
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

	it('rolls back document, receipt, identities, and queued work when durable event recording fails', async () => {
		failEventInsert = true;
		await expect(seed()).rejects.toThrow('division by zero');
		failEventInsert = false;
		expect((await store.read(scope)).revision).toBe(0);
		expect((await store.read(scope)).document.nodes).toEqual({});
		for (const table of [
			'command_receipts',
			'node_identities',
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
		await expect(
			submit(104, {
				type: 'add',
				nodes: [
					{
						id: rootId,
						type: 'round',
						name: 'Reused',
						url: '',
						parentId: null,
					},
				],
			})
		).rejects.toMatchObject({ code: 'conflict' });
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
});

import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest';
import {
	applyHuntStateUpdate,
	validateHuntDocument,
	HuntCommandError,
} from '../../document.js';
import type { HuntScope } from '../../document.js';
import { PuzzlehuntModel } from '../../model/puzzlehunt.js';
import { startLocalPostgres } from '../fixtures/postgres.js';

let database: Awaited<ReturnType<typeof startLocalPostgres>>;
let scope: HuntScope;
let rootId: string;
let puzzleId: string;

beforeAll(async () => {
	database = await startLocalPostgres();
}, 60000);
afterAll(async () => {
	await database?.close();
}, 30000);
beforeEach(async () => {
	scope = { huntId: crypto.randomUUID(), guildId: 'concurrency-guild' };
	rootId = crypto.randomUUID();
	puzzleId = crypto.randomUUID();
	await database.reset(scope);
	await database.store.submit(scope, {
		commandId: crypto.randomUUID(),
		command: {
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
		},
	});
});

describe('Authoritative commands on multiple PostgreSQL connections', () => {
	it('publishes only committed revision hints and reads one consistent incremental state', async () => {
		const base = await database.store.read(scope);
		const listener = await database.pool.connect();
		const hints: string[] = [];
		const notified = (notification: {
			channel: string;
			payload?: string;
		}) => {
			if (notification.channel === 'hunt_changed')
				hints.push(notification.payload ?? '');
		};
		listener.on('notification', notified);
		await listener.query('LISTEN hunt_changed');
		const writer = await database.pool.connect();
		let open = false;
		try {
			await writer.query('BEGIN');
			open = true;
			await writer.query(
				"UPDATE hunts SET name = 'Changed hunt', revision = 2 WHERE id = $1",
				[scope.huntId]
			);
			await writer.query(
				"UPDATE hunt_nodes SET name = 'Changed puzzle' WHERE hunt_id = $1 AND id = $2",
				[scope.huntId, puzzleId]
			);
			await writer.query(
				'INSERT INTO hunt_changes (hunt_id, revision, node_ids) VALUES ($1, 2, $2::uuid[])',
				[scope.huntId, [puzzleId]]
			);
			await writer.query("SELECT pg_notify('hunt_changed', $1)", [
				JSON.stringify({ huntId: scope.huntId, revision: 2 }),
			]);
			const before = await database.store.readUpdates(scope, 1);
			expect(applyHuntStateUpdate(base, before)).toEqual(base);
			expect(hints).toEqual([]);
			await writer.query('COMMIT');
			open = false;
			await vi.waitFor(() => expect(hints).toHaveLength(1));
			expect(JSON.parse(hints[0])).toEqual({
				huntId: scope.huntId,
				revision: 2,
			});
			const update = await database.store.readUpdates(scope, 1);
			if (update.type !== 'delta') throw new Error('Expected delta.');
			expect(update.delta.upsertNodes).toHaveLength(1);
			expect(update.delta).toMatchObject({
				name: 'Changed hunt',
				revision: 2,
			});
			expect(applyHuntStateUpdate(base, update)).toEqual(
				await database.store.read(scope)
			);
			await writer.query('BEGIN');
			open = true;
			await writer.query("SELECT pg_notify('hunt_changed', $1)", [
				JSON.stringify({ huntId: scope.huntId, revision: 3 }),
			]);
			await writer.query('ROLLBACK');
			open = false;
			// An ordered barrier proves the rolled-back notification never arrived.
			await writer.query("SELECT pg_notify('hunt_changed', $1)", [
				JSON.stringify({ huntId: scope.huntId, revision: 2 }),
			]);
			await vi.waitFor(() => expect(hints).toHaveLength(2));
			expect(hints.map((value) => JSON.parse(value).revision)).toEqual([
				2, 2,
			]);
		} finally {
			if (open) await writer.query('ROLLBACK');
			writer.release();
			await listener.query('UNLISTEN hunt_changed');
			listener.removeListener('notification', notified);
			listener.release();
		}
	});

	it('preserves both additions after two transactions actually wait on the hunt lock', async () => {
		const blocker = await database.pool.connect();
		await blocker.query('BEGIN');
		await blocker.query('SELECT id FROM hunts WHERE id = $1 FOR UPDATE', [
			scope.huntId,
		]);
		const commands = ['First', 'Second'].map((name) =>
			database.store.submit(scope, {
				commandId: crypto.randomUUID(),
				command: {
					type: 'add',
					nodes: [
						{
							id: crypto.randomUUID(),
							type: 'puzzle',
							name,
							url: '',
							parentId: rootId,
						},
					],
				},
			})
		);
		try {
			await vi.waitFor(
				async () => {
					const result = await database.pool.query<{ count: string }>(
						`SELECT count(*)::text FROM pg_stat_activity
					 WHERE datname = current_database() AND wait_event_type = 'Lock'
					 AND query LIKE '%FOR UPDATE%'`
					);
					expect(Number(result.rows[0].count)).toBe(2);
				},
				{ timeout: 10000, interval: 20 }
			);
		} finally {
			await blocker.query('ROLLBACK');
			blocker.release();
			await Promise.allSettled(commands);
		}
		await Promise.all(commands);
		const snapshot = await database.store.read(scope);
		validateHuntDocument(snapshot.document);
		expect(
			Object.values(snapshot.document.nodes)
				.filter((node) => node.type === 'puzzle')
				.map((node) => node.name)
				.sort()
		).toEqual(['First', 'Puzzle', 'Second']);
		expect(snapshot.revision).toBe(3);
	});

	it('cannot commit mutually cyclic concurrent moves', async () => {
		const secondId = crypto.randomUUID();
		await database.store.submit(scope, {
			commandId: crypto.randomUUID(),
			command: {
				type: 'add',
				nodes: [
					{
						id: secondId,
						type: 'round',
						name: 'Second',
						url: '',
						parentId: null,
					},
				],
			},
		});
		const results = await Promise.allSettled([
			database.store.submit(scope, {
				commandId: crypto.randomUUID(),
				command: { type: 'move', nodeId: rootId, parentId: secondId },
			}),
			database.store.submit(scope, {
				commandId: crypto.randomUUID(),
				command: { type: 'move', nodeId: secondId, parentId: rootId },
			}),
		]);
		expect(
			results.filter((result) => result.status === 'fulfilled')
		).toHaveLength(1);
		const rejected = results.find((result) => result.status === 'rejected');
		expect(rejected?.status).toBe('rejected');
		if (rejected?.status === 'rejected') {
			expect(rejected.reason).toBeInstanceOf(HuntCommandError);
		}
		validateHuntDocument((await database.store.read(scope)).document);
	});

	it('recovers a lost acknowledgement without replaying a solve over a newer solve', async () => {
		let loseResponse = true;
		const model = await PuzzlehuntModel.load(
			{
				read: (scope) => database.store.read(scope),
				async submit(scope, request) {
					const result = await database.store.submit(scope, request);
					if (loseResponse) {
						loseResponse = false;
						throw new Error(
							'Simulated response loss after PostgreSQL commit.'
						);
					}
					return result;
				},
			},
			scope
		);
		model.solve(puzzleId, 'FIRST');
		await expect(model.flush()).rejects.toThrow('response loss');
		await database.store.submit(scope, {
			commandId: crypto.randomUUID(),
			command: {
				type: 'set-property',
				property: 'answer',
				nodeId: puzzleId,
				value: 'LATER',
			},
		});
		await model.retryPending();
		expect(model.getPuzzle(puzzleId).answer).toBe('LATER');
		expect(model.committedSnapshot.revision).toBe(3);
		const logs = await database.pool.query<{ count: string }>(
			`SELECT count(*)::text FROM integration_events
			 WHERE hunt_id = $1 AND payload->'event'->>'type' = 'puzzle-solved'`,
			[scope.huntId]
		);
		expect(Number(logs.rows[0].count)).toBe(2);
	});

	it('reads one committed metadata/node snapshot while another connection is writing', async () => {
		const writer = await database.pool.connect();
		await writer.query('BEGIN');
		let transactionOpen = true;
		try {
			await writer.query(
				`UPDATE hunts SET name = 'New hunt name', revision = 2 WHERE id = $1`,
				[scope.huntId]
			);
			await writer.query(
				`UPDATE hunt_nodes SET name = 'New puzzle name' WHERE hunt_id = $1 AND id = $2`,
				[scope.huntId, puzzleId]
			);
			const before = await database.store.read(scope);
			expect(before.revision).toBe(1);
			expect(before.name).toBe('Contract test hunt');
			expect(before.document.nodes[puzzleId].name).toBe('Puzzle');
			await writer.query('COMMIT');
			transactionOpen = false;
			const after = await database.store.read(scope);
			expect(after.revision).toBe(2);
			expect(after.name).toBe('New hunt name');
			expect(after.document.nodes[puzzleId].name).toBe('New puzzle name');
		} finally {
			if (transactionOpen) {
				await writer.query('ROLLBACK');
			}
			writer.release();
		}
	});

	it('replaces a skewed optimistic status timestamp with database time', async () => {
		const before = Date.now();
		const model = await PuzzlehuntModel.load(database.store, scope);
		const future = before + 365 * 24 * 60 * 60 * 1000;
		const clock = vi.spyOn(Date, 'now').mockReturnValue(future);
		try {
			model.updateStatus(model.getPuzzle(puzzleId), 'Working');
			expect(model.getPuzzle(puzzleId).lastStatusUpdate).toBe(future);
			await model.flush();
		} finally {
			clock.mockRestore();
		}
		const timestamp = model.getPuzzle(puzzleId).lastStatusUpdate;
		expect(timestamp).toBeGreaterThanOrEqual(before);
		expect(timestamp).toBeLessThanOrEqual(Date.now());
	});
});

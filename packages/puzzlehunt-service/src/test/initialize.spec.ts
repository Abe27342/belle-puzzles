import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PostgresPuzzlehuntStore } from '@belle-puzzles/puzzlehunt-model/postgres';
import type { HuntDatabasePool } from '@belle-puzzles/puzzlehunt-model/postgres';
import { initializePuzzlehuntDatabase } from '../../scripts/initialize.js';

let database: PGlite;
beforeEach(() => {
	database = new PGlite();
});
afterEach(async () => {
	await database.close();
});

function fixture(onQuery?: (text: string) => void) {
	const connection = {
		async query<Row extends Record<string, unknown>>(
			text: string,
			values?: unknown[]
		) {
			onQuery?.(text);
			// PGlite uses a separate batch API for the schema's multiple statements.
			if (text.includes('CREATE TABLE')) {
				await database.exec(text);
				return { rows: [] };
			}
			return database.query<Row>(text, values);
		},
		release: vi.fn(),
	};
	const pool = {
		connect: vi.fn(async () => connection),
	} satisfies HuntDatabasePool;
	return { connection, pool, store: new PostgresPuzzlehuntStore(pool) };
}

describe('Puzzlehunt database initialization', { timeout: 10000 }, () => {
	it('creates a selected empty hunt ready for commands and revision reads', async () => {
		const { pool, store } = fixture();
		const scope = await initializePuzzlehuntDatabase(
			pool,
			'123456789012345678',
			"My guild's hunt"
		);
		expect(await store.readActive(scope.guildId)).toEqual({
			...scope,
			schemaVersion: 1,
			revision: 0,
			document: { name: "My guild's hunt", configuration: {}, nodes: {} },
		});
		const node = {
			id: '00000000-0000-4000-8000-000000000001',
			type: 'round' as const,
			name: 'Round',
			url: '',
		};
		const result = await store.submit(scope, {
			commandId: '00000000-0000-4000-8000-000000000002',
			command: { type: 'add', nodes: [node] },
		});
		expect(result.snapshot.document.nodes[node.id]).toMatchObject(node);
		expect(await store.readRevision(scope)).toBe(1);
		expect(await store.readUpdates(scope, 0)).toMatchObject({
			type: 'delta',
			delta: {
				revision: 1,
				upsertNodes: [expect.objectContaining(node)],
			},
		});
	});

	it('rejects reinitialization without changing existing hunts or selection', async () => {
		const { pool, store } = fixture();
		const scope = await initializePuzzlehuntDatabase(pool, '123', 'Hunt');
		await store.submit(scope, {
			commandId: '00000000-0000-4000-8000-000000000002',
			command: {
				type: 'add',
				nodes: [
					{
						id: '00000000-0000-4000-8000-000000000001',
						type: 'round',
						name: 'Existing round',
						url: '',
					},
				],
			},
		});
		const before = await store.readActive(scope.guildId);
		await expect(
			initializePuzzlehuntDatabase(pool, '456', 'Another hunt')
		).rejects.toThrow('already exists');
		expect(await store.readActive(scope.guildId)).toEqual(before);
		expect((await database.query('SELECT id FROM hunts')).rows).toEqual([
			{ id: scope.huntId },
		]);
	});

	it('rolls back schema and hunt creation together if selection fails', async () => {
		const { pool, connection } = fixture((text) => {
			if (text.startsWith('INSERT INTO active_hunts')) {
				throw new Error('Selection failed.');
			}
		});
		await expect(
			initializePuzzlehuntDatabase(pool, '123', 'Hunt')
		).rejects.toThrow('Selection failed.');
		expect(connection.release).toHaveBeenCalledOnce();
		expect(
			(
				await database.query(
					`SELECT table_name FROM information_schema.tables
					 WHERE table_schema = 'public'`
				)
			).rows
		).toEqual([]);
		const retry = fixture();
		const scope = await initializePuzzlehuntDatabase(
			retry.pool,
			'123',
			'Hunt'
		);
		expect(await retry.store.readActive('123')).toMatchObject(scope);
	});

	it.each([
		['not-a-guild', 'Hunt'],
		['123', ' '],
	])(
		'rejects invalid setup arguments before connecting (%s, %s)',
		async (guildId, name) => {
			const { pool } = fixture();
			await expect(
				initializePuzzlehuntDatabase(pool, guildId, name)
			).rejects.toThrow();
			expect(pool.connect).not.toHaveBeenCalled();
		}
	);
});

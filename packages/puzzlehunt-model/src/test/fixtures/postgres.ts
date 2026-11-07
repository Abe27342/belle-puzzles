import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { Pool } from 'pg';
import { PostgresPuzzlehuntStore } from '../../postgres/store.js';
import type { HuntScope } from '../../document.js';
import { availablePort } from './utils.js';

/**
 * Locally running postgres service with lifecycle operations.
 *
 * The database is initialized to have the latest database schema as defined in `schema.sql`.
 */
export interface LocalPostgres {
	/**
	 * See {@link https://node-postgres.com/apis/pool} -- pool for database client use.
	 */
	pool: Pool;
	/**
	 * Puzzlehunt manipulation store built over {@link pool}.
	 */
	store: PostgresPuzzlehuntStore;
	/**
	 * Resets the database to a state with a single hunt with the supplied scope.
	 * @remarks
	 * Specifically, removes all existing hunts, then inserts a hunt with the provided scope.
	 * @param scope
	 */
	reset(scope: HuntScope): Promise<void>;
	/**
	 * Close the database and clean up all associated resources. This deletes all underlying data.
	 */
	close(): Promise<void>;
}

/**
 * Start a locally running postgres service initialized with the current puzzlehunt schema.
 */
export async function startLocalPostgres(): Promise<LocalPostgres> {
	const databaseDir = await mkdtemp(
		join(tmpdir(), 'belle-puzzles-postgres-')
	);
	const port = await availablePort('Postgres');
	const password = crypto.randomUUID();
	const cluster = new EmbeddedPostgres({
		databaseDir,
		port,
		user: 'postgres',
		password,
		// Automatically cleans up stored files on `cluster.stop()`
		persistent: false,
		postgresFlags: ['-h', '127.0.0.1'],
		autoRehydrateSymlinks: true,
	});
	let started = false;
	const pool = new Pool({
		host: '127.0.0.1',
		port,
		user: 'postgres',
		password,
		database: 'postgres',
		max: 5,
		connectionTimeoutMillis: 10000,
	});
	try {
		await cluster.initialise();
		await cluster.start();
		started = true;
		await pool.query(
			await readFile(
				createRequire(import.meta.url).resolve(
					'@belle-puzzles/puzzlehunt-model/postgres/schema.sql'
				),
				'utf8'
			)
		);
	} catch (error) {
		await pool.end();
		if (started) {
			await cluster.stop();
		} else {
			await rm(databaseDir, { recursive: true, force: true });
		}
		throw error;
	}
	return {
		pool,
		store: new PostgresPuzzlehuntStore(pool),
		async reset(scope: HuntScope) {
			await pool.query('TRUNCATE hunts CASCADE');
			await pool.query(
				`INSERT INTO hunts (id, guild_id, name, schema_version)
				 VALUES ($1, $2, 'Contract test hunt', 1)`,
				[scope.huntId, scope.guildId]
			);
		},
		async close() {
			try {
				await pool.end();
			} finally {
				await cluster.stop();
			}
		},
	};
}

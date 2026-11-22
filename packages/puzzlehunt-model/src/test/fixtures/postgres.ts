import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { Pool } from 'pg';
import { PostgresPuzzlehuntStore } from '../../postgres/store.js';
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
	 * Resets the database to an empty state.
	 * @remarks
	 * Specifically, removes all existing hunts and their associated data.
	 */
	reset(): Promise<void>;
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
	const connections = new Set<Promise<void>>();
	pool.on('connect', (client) => {
		const closed = new Promise<void>((resolve) => {
			client.once('end', () => {
				connections.delete(closed);
				resolve();
			});
		});
		connections.add(closed);
	});
	async function closePool() {
		// pool.end() can resolve before its clients have actually disconnected.
		await pool.end();
		await Promise.all(connections);
	}
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
		await closePool();
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
		async reset() {
			await pool.query('TRUNCATE hunts CASCADE');
		},
		async close() {
			try {
				await closePool();
			} finally {
				await cluster.stop();
			}
		},
	};
}

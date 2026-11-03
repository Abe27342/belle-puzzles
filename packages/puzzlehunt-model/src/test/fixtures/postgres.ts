import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { Pool } from 'pg';
import { PostgresPuzzlehuntStore } from '../../postgres/store.js';
import type { HuntScope } from '../../document.js';

async function availablePort(): Promise<number> {
	const server = createServer();
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	const address = server.address();
	if (!address || typeof address === 'string') {
		throw new Error('Local PostgreSQL test port could not be allocated.');
	}
	await new Promise<void>((resolve, reject) =>
		server.close((error) => (error ? reject(error) : resolve()))
	);
	return address.port;
}

/** Own a real loopback PostgreSQL service; never connect to or reset a user database. */
export async function startLocalPostgres() {
	const databaseDir = await mkdtemp(
		join(tmpdir(), 'belle-puzzles-postgres-')
	);
	const port = await availablePort();
	const password = crypto.randomUUID();
	const cluster = new EmbeddedPostgres({
		databaseDir,
		port,
		user: 'postgres',
		password,
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
				new URL('../../postgres/schema.sql', import.meta.url),
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

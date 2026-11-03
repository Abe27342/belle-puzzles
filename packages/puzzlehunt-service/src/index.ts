import { createServer } from 'node:http';
import { Pool } from 'pg';
import { PostgresPuzzlehuntStore } from '@belle-puzzles/puzzlehunt-model/postgres';
import { createPuzzlehuntApp } from './app.js';
import { createDiscordHuntAuthorizer } from './auth.js';
import { readServiceConfiguration } from './config.js';

async function main(): Promise<void> {
	const config = readServiceConfiguration(process.env);
	const pool = new Pool({
		connectionString: config.databaseUrl,
		max: 5,
		connectionTimeoutMillis: 10000,
		statement_timeout: 15000,
	});
	pool.on('error', (error) =>
		console.error('Idle PostgreSQL connection failed.', error)
	);
	const app = createPuzzlehuntApp({
		store: new PostgresPuzzlehuntStore(pool),
		authorize: createDiscordHuntAuthorizer(config),
		allowedOrigins: config.allowedOrigins,
	});
	const server = createServer(app);
	server.headersTimeout = 10000;
	server.requestTimeout = 30000;
	try {
		// Schema application is explicit; never create or migrate a database at service startup.
		await pool.query('SELECT 1 FROM hunts LIMIT 0');
		await new Promise<void>((resolve, reject) => {
			server.once('error', reject);
			server.listen(config.port, config.host, () => {
				server.off('error', reject);
				resolve();
			});
		});
	} catch (error) {
		await pool.end();
		throw error;
	}
	let closing = false;
	async function close(): Promise<void> {
		if (closing) {
			return;
		}
		closing = true;
		const timeout = setTimeout(() => {
			console.error('Puzzlehunt service shutdown timed out.');
			process.exit(1);
		}, 30000);
		timeout.unref();
		try {
			try {
				await new Promise<void>((resolve, reject) => {
					server.close((error) =>
						error ? reject(error) : resolve()
					);
				});
			} finally {
				await pool.end();
			}
		} finally {
			clearTimeout(timeout);
		}
	}
	server.on('error', (error) => {
		console.error('Puzzlehunt HTTP server failed.', error);
		process.exitCode = 1;
		void close().catch((shutdownError) => {
			console.error('Puzzlehunt service shutdown failed.', shutdownError);
		});
	});
	for (const signal of ['SIGINT', 'SIGTERM'] as const) {
		process.once(signal, () => {
			void close().catch((error) => {
				console.error('Puzzlehunt service shutdown failed.', error);
				process.exitCode = 1;
			});
		});
	}
	const address = server.address();
	console.log(
		`Puzzlehunt API listening on ${
			typeof address === 'object' && address ? address.port : config.port
		}.`
	);
}

void main().catch((error) => {
	console.error('Puzzlehunt service startup failed.', error);
	process.exitCode = 1;
});

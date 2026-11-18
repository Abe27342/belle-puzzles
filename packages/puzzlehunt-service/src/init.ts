import './register-env.js';
import { Pool } from 'pg';
import { readServiceConfiguration } from './config.js';
import { initializePuzzlehuntDatabase } from './initialize.js';

async function main(): Promise<void> {
	const [guildId, name, ...extra] = process.argv.slice(2);
	if (!guildId || !name || extra.length > 0) {
		throw new Error(
			'Usage: pnpm init:puzzlehunt-service <guild-id> "<hunt name>"'
		);
	}
	const config = readServiceConfiguration(process.env);
	const pool = new Pool({
		connectionString: config.databaseUrl,
		max: 1,
		connectionTimeoutMillis: 10000,
	});
	pool.on('error', (error) =>
		console.error('Idle PostgreSQL connection failed.', error)
	);
	try {
		const scope = await initializePuzzlehuntDatabase(pool, guildId, name);
		console.log(
			`Initialized active hunt ${scope.huntId} for guild ${scope.guildId}.`
		);
	} finally {
		await pool.end();
	}
}

void main().catch((error) => {
	console.error('Puzzlehunt database initialization failed.', error);
	process.exitCode = 1;
});

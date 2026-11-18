import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { snowflake } from '@belle-puzzles/puzzlehunt-model/document';
import type { HuntScope } from '@belle-puzzles/puzzlehunt-model/document';
import type { HuntDatabasePool } from '@belle-puzzles/puzzlehunt-model/postgres';

/** Apply the schema and create an empty active hunt in one transaction. */
export async function initializePuzzlehuntDatabase(
	pool: HuntDatabasePool,
	guildId: string,
	name: string
): Promise<HuntScope> {
	if (!/^[0-9]{1,20}$/.test(guildId)) {
		throw new Error('Expected a Discord guild ID.');
	}
	if (!name.trim()) {
		throw new Error('Expected a nonempty hunt name.');
	}
	const schema = await readFile(
		createRequire(import.meta.url).resolve(
			'@belle-puzzles/puzzlehunt-model/postgres/schema.sql'
		),
		'utf8'
	);
	const scope: HuntScope = {
		huntId: randomUUID(),
		guildId: snowflake(guildId),
	};
	const connection = await pool.connect();
	try {
		await connection.query('BEGIN');
		try {
			await connection.query(schema);
			await connection.query(
				`INSERT INTO hunts (id, guild_id, name, schema_version)
				 VALUES ($1, $2, $3, 1)`,
				[scope.huntId, scope.guildId, name]
			);
			await connection.query(
				'INSERT INTO active_hunts (guild_id, hunt_id) VALUES ($1, $2)',
				[scope.guildId, scope.huntId]
			);
			await connection.query('COMMIT');
		} catch (error) {
			await connection.query('ROLLBACK');
			throw error;
		}
	} finally {
		connection.release();
	}
	return scope;
}

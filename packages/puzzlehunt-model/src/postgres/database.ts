import { HuntCommandError, isUuid } from '../document.js';
import type { HuntScope } from '../document.js';

/** Structural subset of a pg Pool/PoolClient; constructing a store opens no connection. */
export interface HuntDatabaseConnection {
	query<Row extends Record<string, unknown>>(
		text: string,
		values?: unknown[]
	): Promise<{ rows: Row[] }>;
	release(error?: Error): void;
}

export interface HuntDatabasePool {
	connect(): Promise<HuntDatabaseConnection>;
}

export async function withConnection<TReturn>(
	pool: HuntDatabasePool,
	cb: (connection: HuntDatabaseConnection) => Promise<TReturn>
): Promise<TReturn> {
	const connection = await pool.connect();
	try {
		return await cb(connection);
	} finally {
		connection.release();
	}
}

export function validateScope(scope: HuntScope): void {
	if (!isUuid(scope.huntId) || !scope.guildId) {
		throw new HuntCommandError('invalid-command', 'Invalid hunt scope.');
	}
}

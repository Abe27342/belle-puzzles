import type {
	HuntCommandResult,
	HuntIntegrationCommand,
	HuntScope,
} from '../document.js';
import { validateScope, withConnection } from './database.js';
import type { HuntDatabasePool } from './database.js';
import { commitHuntCommand } from './store.js';

export type HuntIntegrationTarget = 'discord' | 'google';

/** Worker-only bookkeeping, independent of the user-facing document store instance. */
export class PostgresHuntIntegrationStore {
	constructor(private readonly pool: HuntDatabasePool) {}

	/** Keep this method behind a worker-only service boundary. */
	public submitIntegration(
		scope: HuntScope,
		commandId: string,
		command: HuntIntegrationCommand
	): Promise<HuntCommandResult> {
		return commitHuntCommand(this.pool, scope, commandId, command);
	}

	/** A worker may only clear the exact generation it reconciled. */
	public async acknowledgeReconciliation(
		scope: HuntScope,
		target: HuntIntegrationTarget,
		requestedRevision: number
	): Promise<boolean> {
		validateScope(scope);
		return await withConnection(this.pool, async (connection) => {
			const { rows } = await connection.query<{ hunt_id: string }>(
				`DELETE FROM integration_jobs j USING hunts h
				 WHERE j.hunt_id = h.id AND h.id = $1 AND h.guild_id = $2
				 AND j.target = $3 AND j.requested_revision = $4
				 RETURNING j.hunt_id`,
				[scope.huntId, scope.guildId, target, requestedRevision]
			);
			return rows.length > 0;
		});
	}
}

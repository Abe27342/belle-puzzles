import type {
	HuntCommandResult,
	HuntIntegrationCommand,
	HuntScope,
} from '../document.js';
import type { HuntDatabasePool } from './database.js';
import { commitHuntCommand } from './store.js';

/** Worker-only bookkeeping, independent of the user-facing document store instance. */
export class PostgresHuntIntegrationStore {
	constructor(private readonly pool: HuntDatabasePool) {}

	/**
	 * Keep this method behind a worker-only service boundary.
	 * Atomically persist an optional result and complete one item, using its ID to deduplicate retries.
	 */
	public completeWork(
		scope: HuntScope,
		workId: string,
		result?: HuntIntegrationCommand
	): Promise<HuntCommandResult> {
		return commitHuntCommand(this.pool, scope, workId, result, workId);
	}
}

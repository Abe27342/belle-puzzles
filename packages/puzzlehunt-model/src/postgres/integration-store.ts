import type {
	HuntCommandResult,
	HuntConfiguration,
	HuntDocumentEvent,
	HuntIntegrationClient,
	HuntIntegrationCommand,
	HuntScope,
} from '../document.js';
import { HuntCommandError, snowflake } from '../document.js';
import { validateScope, withConnection } from './database.js';
import type { HuntDatabaseConnection, HuntDatabasePool } from './database.js';
import type { HuntIntegrationTarget } from './integrations.js';
import { commitHuntCommand } from './store.js';

export type IntegrationJob = {
	id: string;
	nodeId: string;
	target: HuntIntegrationTarget;
	attempts: number;
	hadAssociation: boolean;
	/** Partial external results retained across retries and cancellation of this job. */
	confirmed: Record<string, string>;
};

export type IntegrationEvent = {
	commandId: string;
	ordinal: number;
	attempts: number;
	payload: {
		event: HuntDocumentEvent;
		configuration: HuntConfiguration;
		/** Captured at enqueue time, including if the round is subsequently deleted. */
		parentName?: string;
	};
};

function boundedLimit(limit: number): number {
	if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
		throw new Error('Integration scan limit must be between 1 and 1000.');
	}
	return limit;
}

/**
 * Worker-only bookkeeping, independent of the user-facing document store instance.
 *
 * @remarks
 * Exported from `/postgres`; do not expose this capability through user commands or
 * general HTTP routes. {@link discover} pages all hunts in a caller-authorized guild.
 * {@link acquire} returns an owned handle, or `undefined` if another connection owns
 * that guild. Always release the handle in `finally` and keep the pool open until all
 * handles have been released. Session advisory locks require a direct/session-pooled
 * connection.
 *
 * Requires an initialized schema containing the integration columns from the
 * opt-in `schema.sql`. This store does not provide schema-only initialization or a
 * migration runner.
 */
export class PostgresHuntIntegrationStore implements HuntIntegrationClient {
	constructor(private readonly pool: HuntDatabasePool) {}

	/** Enumerate all hunts in an explicitly authorized guild, including inactive hunts. */
	public async discover(
		guildId: string,
		afterHuntId?: string,
		limit = 20
	): Promise<HuntScope[]> {
		if (!guildId) throw new Error('An authorized guild is required.');
		return withConnection(this.pool, async (connection) => {
			const { rows } = await connection.query<{ id: string }>(
				`SELECT id FROM hunts WHERE guild_id = $1
				 AND ($2::uuid IS NULL OR id > $2::uuid) ORDER BY id LIMIT $3`,
				[guildId, afterHuntId ?? null, boundedLimit(limit)]
			);
			return rows.map(({ id }) => ({
				huntId: id,
				guildId: snowflake(guildId),
			}));
		});
	}

	/**
	 * Hold a dedicated session advisory lock until release. Guild-wide exclusion also
	 * prevents simultaneous processing of different hunts sharing Discord resources.
	 * Use a direct/session-pooled connection, never transaction-mode PgBouncer.
	 */
	public async acquire(
		scope: HuntScope
	): Promise<OwnedHuntIntegrations | undefined> {
		validateScope(scope);
		const connection = await this.pool.connect();
		try {
			const { rows } = await connection.query<{ acquired: boolean }>(
				`SELECT pg_try_advisory_lock(hashtextextended('belle-integrations:' || guild_id, 0)) AS acquired
				 FROM hunts WHERE id = $1 AND guild_id = $2`,
				[scope.huntId, scope.guildId]
			);
			if (rows.length === 0)
				throw new HuntCommandError(
					'not-found',
					'Hunt not found in this guild.'
				);
			if (!rows[0].acquired) {
				connection.release();
				return undefined;
			}
			return new OwnedHuntIntegrations(connection, scope);
		} catch (error) {
			connection.release(
				error instanceof Error ? error : new Error(String(error))
			);
			throw error;
		}
	}

	/**
	 * Keep this method behind a worker-only service boundary.
	 * Atomically persist an optional result and complete one item, using its ID to deduplicate retries.
	 *
	 * @remarks
	 * Compares the current association with the job's enqueue-time association under
	 * the authoritative hunt lock. Changed/manual associations reject stale results;
	 * same-task receipt retries remain idempotent and do not replay writes over newer
	 * state. Cancelled/replaced nodes cannot gain results. Completion does not enqueue
	 * follow-up integration jobs/events; workers must reconcile derived Discord state
	 * after completion and periodically.
	 */
	public completeWork(
		scope: HuntScope,
		workId: string,
		result?: HuntIntegrationCommand
	): Promise<HuntCommandResult> {
		return commitHuntCommand(this.pool, scope, workId, result, workId);
	}
}

/**
 * Capabilities tied to one live ownership connection. Do not share across concurrent passes.
 *
 * @remarks
 * Always await {@link release} in `finally`. The handle observes connection loss and
 * cannot be used after release. Job/event attempts, due times, errors, confirmed IDs and
 * delivery acknowledgements are persisted. Scans are limited to 1-1000 entries per call.
 *
 * Process {@link dueJobs} using {@link startJob}, then the store's
 * {@link PostgresHuntIntegrationStore.completeWork} or {@link failJob}. Jobs are selected
 * parent-first before applying the batch bound; older pending/backed-off jobs
 * gate newer jobs for the same node/target.
 *
 * Process {@link dueEvents} using {@link startEvent}, then acknowledge with
 * {@link completeEvent} or record failure with {@link failEvent}.
 * Logs retain their distinct order; deletion tombstones
 * can run independently of backed-off logs.
 *
 * {@link confirmResource} merges partial results on the job itself, including if it
 * was cancelled during an external call. New jobs never inherit those results.
 * Operations with no persisted result are retried, even when their outcome is unknown;
 * duplicate external resources/messages are accepted and can be cleaned up manually.
 */
export class OwnedHuntIntegrations {
	private released = false;
	private lost: Error | undefined;
	private readonly onConnectionError = (error: Error) => {
		this.lost = error;
	};

	constructor(
		private readonly connection: HuntDatabaseConnection,
		public readonly scope: HuntScope
	) {
		connection.on?.('error', this.onConnectionError);
	}

	private query<Row extends Record<string, unknown>>(
		text: string,
		values: unknown[] = []
	) {
		if (this.released)
			throw new Error('Integration ownership has been released.');
		if (this.lost) throw this.lost;
		return this.connection.query<Row>(text, [this.scope.huntId, ...values]);
	}

	/** Check the ownership connection before derived work with no job/event bookkeeping. */
	public async assertOwnership(): Promise<void> {
		await this.query('SELECT $1::uuid');
	}

	public async release(): Promise<void> {
		if (this.released) return;
		this.released = true;
		let failure: Error | undefined;
		try {
			if (this.lost) throw this.lost;
			await this.connection.query(
				`SELECT pg_advisory_unlock(hashtextextended('belle-integrations:' || $1, 0))`,
				[this.scope.guildId]
			);
		} catch (error) {
			failure = error instanceof Error ? error : new Error(String(error));
			throw failure;
		} finally {
			this.connection.removeListener?.('error', this.onConnectionError);
			this.connection.release(failure);
		}
	}

	/** An older pending/backed-off job gates later jobs for the same target. */
	public async dueJobs(limit = 50): Promise<IntegrationJob[]> {
		const { rows } = await this.query<IntegrationJob>(
			`WITH RECURSIVE tree AS (
				SELECT id, 0 AS depth FROM hunt_nodes WHERE hunt_id = $1 AND parent_id IS NULL
				UNION ALL
				SELECT n.id, tree.depth + 1 FROM hunt_nodes n JOIN tree ON n.parent_id = tree.id
				WHERE n.hunt_id = $1
			 )
			 SELECT j.id, j.node_id AS "nodeId", j.target, j.attempts, j.confirmed,
			 (j.payload->'node'->(CASE WHEN j.target = 'discord' THEN 'discord' ELSE 'sheetId' END))
			 IS NOT NULL AS "hadAssociation"
			 FROM integration_jobs j LEFT JOIN tree ON tree.id = j.node_id WHERE j.hunt_id = $1
			 AND j.completed_at IS NULL AND j.cancelled_at IS NULL
			 AND j.available_at <= clock_timestamp()
			 AND NOT EXISTS (
				SELECT 1 FROM integration_jobs older
				WHERE older.hunt_id = j.hunt_id AND older.node_id = j.node_id AND older.target = j.target
				AND older.completed_at IS NULL AND older.cancelled_at IS NULL
				AND (older.source_revision, older.id) < (j.source_revision, j.id)
			 ) ORDER BY COALESCE(tree.depth, 0), j.source_revision, j.id LIMIT $2`,
			[boundedLimit(limit)]
		);
		return rows;
	}

	public async startJob(id: string): Promise<boolean> {
		const { rows } = await this.query(
			`UPDATE integration_jobs SET attempts = attempts + 1
			 WHERE hunt_id = $1 AND id = $2 AND completed_at IS NULL AND cancelled_at IS NULL
			 AND available_at <= clock_timestamp() RETURNING id`,
			[id]
		);
		return rows.length === 1;
	}

	public async failJob(
		id: string,
		error: string,
		delayMs: number
	): Promise<void> {
		await this.query(
			`UPDATE integration_jobs SET last_error = $3,
			 available_at = clock_timestamp() + $4::double precision * interval '1 millisecond'
			 WHERE hunt_id = $1 AND id = $2`,
			[id, error, delayMs]
		);
	}

	/** Only the oldest undelivered log is eligible; tombstone cleanup is independent. */
	public async dueEvents(limit = 50): Promise<IntegrationEvent[]> {
		const { rows } = await this.query<IntegrationEvent>(
			`SELECT e.command_id AS "commandId", e.ordinal, e.attempts, e.payload
			 FROM integration_events e WHERE e.hunt_id = $1 AND e.delivered_at IS NULL
			 AND e.available_at <= clock_timestamp()
			 AND (e.payload->'event'->>'type' = 'node-deleted' OR NOT EXISTS (
				SELECT 1 FROM integration_events older
				WHERE older.hunt_id = e.hunt_id AND older.delivered_at IS NULL
				AND older.payload->'event'->>'type' <> 'node-deleted'
				AND (older.revision, older.ordinal) < (e.revision, e.ordinal)
			 )) ORDER BY e.revision, e.ordinal LIMIT $2`,
			[boundedLimit(limit)]
		);
		return rows;
	}

	public async startEvent(event: IntegrationEvent): Promise<void> {
		const { rows } = await this.query(
			`UPDATE integration_events SET attempts = attempts + 1
			 WHERE hunt_id = $1 AND command_id = $2 AND ordinal = $3 AND delivered_at IS NULL
			 AND available_at <= clock_timestamp() RETURNING ordinal`,
			[event.commandId, event.ordinal]
		);
		if (rows.length !== 1) throw new Error('Event is no longer due.');
	}

	public async completeEvent(
		event: IntegrationEvent,
		messageId?: string
	): Promise<void> {
		await this.query(
			`UPDATE integration_events SET delivered_at = clock_timestamp(), message_id = $4
			 WHERE hunt_id = $1 AND command_id = $2 AND ordinal = $3 AND delivered_at IS NULL`,
			[event.commandId, event.ordinal, messageId ?? null]
		);
	}

	public async failEvent(
		event: IntegrationEvent,
		error: string,
		delayMs: number
	): Promise<void> {
		await this.query(
			`UPDATE integration_events SET last_error = $4,
			 available_at = clock_timestamp() + $5::double precision * interval '1 millisecond'
			 WHERE hunt_id = $1 AND command_id = $2 AND ordinal = $3`,
			[event.commandId, event.ordinal, error, delayMs]
		);
	}

	/** Merge independent confirmed IDs; keep cancelled-job results for inspection, not adoption. */
	public async confirmResource(
		workId: string,
		resource: string,
		id: string
	): Promise<void> {
		if (!id) throw new Error('External operation returned no resource ID.');
		const { rows } = await this.query(
			`UPDATE integration_jobs SET
			 confirmed = confirmed || jsonb_build_object($3::text, $4::text)
			 WHERE hunt_id = $1 AND id = $2
			 AND (NOT (confirmed ? $3) OR confirmed->>$3 = $4) RETURNING id`,
			[workId, resource, id]
		);
		if (rows.length !== 1)
			throw new Error(
				`Cannot checkpoint ${resource} ${id}: job is missing or has a different result.`
			);
	}
}

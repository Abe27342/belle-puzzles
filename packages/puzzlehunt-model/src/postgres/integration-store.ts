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
};

export type IntegrationEvent = {
	commandId: string;
	ordinal: number;
	attempts: number;
	started: boolean;
	payload: {
		event: HuntDocumentEvent;
		configuration: HuntConfiguration;
		/** Captured at enqueue time, including if the round is subsequently deleted. */
		parentName?: string;
	};
};

export type IntegrationProgressTarget = HuntIntegrationTarget | 'embed';
export type IntegrationOperationIntent = {
	readonly name: string;
	readonly parentChannelId?: string;
	readonly indexId?: string;
	readonly googleFolderId?: string;
	readonly channelId?: string;
};
/**
 * Persisted node-operation checkpoints, not hunt setup/resume tracking.
 *
 * @remarks
 * `integration_progress` retains independently merged confirmed IDs, actual requested
 * names/destination IDs, unconfirmed intents and blocking diagnostics across job
 * completion, node deletion, and process restart. Only clear an intent with
 * {@link OwnedHuntIntegrations.retryOperation} when the service definitively did not
 * perform the operation. Unresolved intents and blocked targets require manual inspection;
 * a new task must not automatically adopt or recreate those resources.
 */
export type IntegrationProgress = {
	workId: string | null;
	confirmed: Record<string, string>;
	intents: Record<string, IntegrationOperationIntent>;
	pending: string[];
	blockedError: string | null;
	attempts: number;
	due: boolean;
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
 * Requires an initialized schema containing the integration columns/table from the
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
 * cannot be used after release. Job/event attempts, due times, errors, send intent and
 * delivery acknowledgements are persisted. Scans are limited to 1-1000 entries per call.
 *
 * Process {@link dueJobs} using {@link startJob}, then the store's
 * {@link PostgresHuntIntegrationStore.completeWork} or {@link failJob}. Jobs are selected
 * parent-first before applying the batch bound; older pending/backed-off/paused jobs
 * gate newer jobs for the same node/target.
 *
 * Process {@link dueEvents} using {@link startEvent}, persist send intent with
 * {@link beginEventDelivery}, then acknowledge with {@link completeEvent} or record
 * failure with {@link failEvent}. Logs retain their distinct order; deletion tombstones
 * can run independently of paused logs.
 *
 * Node-operation progress uses {@link progress}, {@link beginOperation},
 * {@link confirmOperation}, {@link retryOperation}, and {@link blockProgress}; see
 * {@link IntegrationProgress} for retention and uncertainty-handling requirements.
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

	/** An older pending/backed-off/paused job gates later jobs for the same target. */
	public async dueJobs(limit = 50): Promise<IntegrationJob[]> {
		const { rows } = await this.query<IntegrationJob>(
			`WITH RECURSIVE tree AS (
				SELECT id, 0 AS depth FROM hunt_nodes WHERE hunt_id = $1 AND parent_id IS NULL
				UNION ALL
				SELECT n.id, tree.depth + 1 FROM hunt_nodes n JOIN tree ON n.parent_id = tree.id
				WHERE n.hunt_id = $1
			 )
			 SELECT j.id, j.node_id AS "nodeId", j.target, j.attempts,
			 (j.payload->'node'->(CASE WHEN j.target = 'discord' THEN 'discord' ELSE 'sheetId' END))
			 IS NOT NULL AS "hadAssociation"
			 FROM integration_jobs j LEFT JOIN tree ON tree.id = j.node_id WHERE j.hunt_id = $1
			 AND j.completed_at IS NULL AND j.cancelled_at IS NULL
			 AND j.paused_at IS NULL AND j.available_at <= clock_timestamp()
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
			 AND paused_at IS NULL AND available_at <= clock_timestamp() RETURNING id`,
			[id]
		);
		return rows.length === 1;
	}

	public async failJob(
		id: string,
		error: string,
		delayMs: number,
		pause = false
	): Promise<void> {
		await this.query(
			`UPDATE integration_jobs SET last_error = $3,
			 available_at = clock_timestamp() + $4::double precision * interval '1 millisecond',
			 paused_at = CASE WHEN $5 THEN clock_timestamp() ELSE paused_at END
			 WHERE hunt_id = $1 AND id = $2`,
			[id, error, delayMs, pause]
		);
	}

	/** Only the oldest undelivered log is eligible; tombstone cleanup is independent. */
	public async dueEvents(limit = 50): Promise<IntegrationEvent[]> {
		const { rows } = await this.query<IntegrationEvent>(
			`SELECT e.command_id AS "commandId", e.ordinal, e.attempts,
			 e.delivery_started_at IS NOT NULL AS started, e.payload
			 FROM integration_events e WHERE e.hunt_id = $1 AND e.delivered_at IS NULL
			 AND e.paused_at IS NULL AND e.available_at <= clock_timestamp()
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
			 AND paused_at IS NULL AND delivery_started_at IS NULL RETURNING ordinal`,
			[event.commandId, event.ordinal]
		);
		if (rows.length !== 1)
			throw new Error(
				'Event already started; inspect delivery before retrying.'
			);
	}

	public async beginEventDelivery(event: IntegrationEvent): Promise<void> {
		const { rows } = await this.query(
			`UPDATE integration_events SET delivery_started_at = clock_timestamp()
			 WHERE hunt_id = $1 AND command_id = $2 AND ordinal = $3 AND delivered_at IS NULL
			 AND paused_at IS NULL AND delivery_started_at IS NULL RETURNING ordinal`,
			[event.commandId, event.ordinal]
		);
		if (rows.length !== 1)
			throw new Error('Event delivery already started or paused.');
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
		delayMs: number,
		pause = false
	): Promise<void> {
		await this.query(
			`UPDATE integration_events SET last_error = $4,
			 available_at = clock_timestamp() + $5::double precision * interval '1 millisecond',
			 paused_at = CASE WHEN $6 THEN clock_timestamp() ELSE paused_at END,
			 delivery_started_at = CASE WHEN $6 THEN delivery_started_at ELSE NULL END
			 WHERE hunt_id = $1 AND command_id = $2 AND ordinal = $3`,
			[event.commandId, event.ordinal, error, delayMs, pause]
		);
	}

	public async progress(
		nodeId: string,
		target: IntegrationProgressTarget
	): Promise<IntegrationProgress | undefined> {
		const { rows } = await this.query<IntegrationProgress>(
			`SELECT work_id AS "workId", confirmed, intents, pending, blocked_error AS "blockedError",
			 attempts, available_at <= clock_timestamp() AS due
			 FROM integration_progress WHERE hunt_id = $1 AND node_id = $2 AND target = $3`,
			[nodeId, target]
		);
		return rows[0];
	}

	/** Persist intent before a create/send. Parallel siblings append distinct pending fields. */
	public async beginOperation(
		nodeId: string,
		target: IntegrationProgressTarget,
		resource: string,
		workId: string | null,
		intent: IntegrationOperationIntent
	): Promise<void> {
		const { rows } = await this.query(
			`INSERT INTO integration_progress (hunt_id, node_id, target, work_id, pending, attempts, intents)
			 SELECT $1, $2, $3, $5, ARRAY[$4]::text[], 1, jsonb_build_object($4::text, $6::jsonb)
			 WHERE EXISTS (SELECT 1 FROM hunt_nodes WHERE hunt_id = $1 AND id = $2)
			 AND ($3 = 'embed' OR EXISTS (
				SELECT 1 FROM integration_jobs WHERE hunt_id = $1 AND id = $5
				AND node_id = $2 AND target = $3 AND completed_at IS NULL AND cancelled_at IS NULL
			 ))
			 ON CONFLICT (hunt_id, node_id, target) DO UPDATE
			 SET pending = array_append(integration_progress.pending, $4), updated_at = clock_timestamp(),
			     attempts = integration_progress.attempts + 1,
			     intents = integration_progress.intents || jsonb_build_object($4::text, $6::jsonb)
			 WHERE integration_progress.blocked_error IS NULL
			 AND integration_progress.work_id IS NOT DISTINCT FROM $5::uuid
			 AND NOT ($4 = ANY(integration_progress.pending))
			 AND NOT (integration_progress.confirmed ? $4)
			 RETURNING node_id`,
			[nodeId, target, resource, workId, JSON.stringify(intent)]
		);
		if (rows.length !== 1)
			throw new Error(
				'Operation already recorded or blocked; inspect integration_progress.'
			);
	}

	public async confirmOperation(
		nodeId: string,
		target: IntegrationProgressTarget,
		resource: string,
		id: string
	): Promise<void> {
		if (!id) throw new Error('External operation returned no resource ID.');
		const { rows } = await this.query(
			`UPDATE integration_progress SET
			 confirmed = confirmed || jsonb_build_object($4::text, $5::text),
			 pending = array_remove(pending, $4), updated_at = clock_timestamp()
			 WHERE hunt_id = $1 AND node_id = $2 AND target = $3
			 AND ($4 = ANY(pending) OR confirmed->>$4 = $5) RETURNING node_id`,
			[nodeId, target, resource, id]
		);
		if (rows.length !== 1)
			throw new Error('Operation confirmation has no matching intent.');
	}

	/** Clear intent only when the external service definitively did not perform the operation. */
	public async retryOperation(
		nodeId: string,
		target: IntegrationProgressTarget,
		resource: string,
		error: string,
		delayMs: number
	): Promise<void> {
		await this.query(
			`UPDATE integration_progress SET pending = array_remove(pending, $4), updated_at = clock_timestamp(),
			 last_error = $5, available_at = clock_timestamp() + $6::double precision * interval '1 millisecond'
			 WHERE hunt_id = $1 AND node_id = $2 AND target = $3`,
			[nodeId, target, resource, error, delayMs]
		);
	}

	public async blockProgress(
		nodeId: string,
		target: IntegrationProgressTarget,
		error: string
	): Promise<void> {
		await this.query(
			`UPDATE integration_progress SET blocked_error = $4, updated_at = clock_timestamp()
			 WHERE hunt_id = $1 AND node_id = $2 AND target = $3`,
			[nodeId, target, error]
		);
	}
}

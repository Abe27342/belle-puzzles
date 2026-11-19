import { ChannelType, type Guild } from 'discord.js';
import { PuzzlehuntModel } from '@belle-puzzles/puzzlehunt-model/model';
import {
	snowflake,
	type DocumentNode,
	type HuntDocumentClient,
	type HuntScope,
	type HuntSnapshot,
	type HuntIntegrationCommand,
} from '@belle-puzzles/puzzlehunt-model/document';
import {
	type IntegrationEvent,
	type IntegrationJob,
	type OwnedHuntIntegrations,
	type PostgresHuntIntegrationStore,
} from '@belle-puzzles/puzzlehunt-model/postgres';
import { createGoogleSheet } from '../integrations/google.js';
import {
	provisionDiscordResources,
	removeDiscordAssociation,
	syncCurrentNode,
	type PuzzlehuntSyncContext,
} from './sync.js';
import {
	puzzleAddedMessage,
	puzzleSolvedMessage,
	puzzleStatusMessage,
} from './logs.js';

/**
 * Caller-owned dependencies and bounds for the opt-in PostgreSQL worker.
 *
 * @remarks
 * Use the model package's `/postgres` exports for the stores and a caller-owned `pg`
 * pool with at least two connections: one for ownership and one for document reads/writes.
 * The pool must support session advisory locks, not transaction-mode PgBouncer.
 * Stop the worker before closing the pool.
 *
 * {@link getGuild} must return the authorized guild with role/channel caches populated.
 * Google copies use a 30-second request timeout.
 *
 * Batch sizes are 1-1000. Defaults per pass are 10 hunts per guild, 50 jobs, 50 events,
 * and 50 reconciliation nodes per hunt, at 30-second intervals. Failed jobs/events
 * use persisted attempts/errors/due times with a 30-second retry base and one-hour cap.
 * Unknown external outcomes are retried too; unrecorded duplicate resources/messages
 * are accepted and can be cleaned up manually.
 *
 * {@link createSheet} is injectable for tests. Worker tests use disposable native
 * PostgreSQL and mocked Discord/Google operations, not real services or secrets.
 */
export interface DurableIntegrationWorkerOptions {
	readonly integrations: PostgresHuntIntegrationStore;
	/** Must read committed state; never pass a mutable/optimistic model. */
	readonly documents: HuntDocumentClient;
	readonly authorizedGuildIds: readonly string[];
	/** Return a loaded guild from the caller's authorized client. */
	readonly getGuild: (guildId: string) => Guild | Promise<Guild>;
	readonly onError: (error: Error, scope?: HuntScope) => void;
	readonly intervalMs?: number;
	readonly huntsPerGuild?: number;
	readonly jobsPerHunt?: number;
	readonly eventsPerHunt?: number;
	readonly nodesPerHunt?: number;
	readonly retryBaseMs?: number;
	readonly retryMaxMs?: number;
	readonly createSheet?: typeof createGoogleSheet;
}

const asError = (error: unknown): Error =>
	error instanceof Error ? error : new Error(String(error));

/**
 * Explicitly constructed/started by the backend owner; importing this starts no work.
 *
 * @remarks
 * Construction leaves default startup and deployed Fluid behavior unchanged. The worker
 * discovers all stored hunts in explicitly authorized guilds, including inactive hunts:
 * selection does not cancel committed work. It does not depend on browser access, model
 * caches, SSE, or notification hints. A PostgreSQL advisory lock excludes a second worker
 * for the whole guild, including another hunt. Ownership is released after each pass or
 * shutdown; connection loss stops further bookkeeping/operation admission.
 *
 * Round-robin hunt/node cursors cover larger hunts across bounded passes. Cursors may
 * restart from the beginning after a process restart, but committed work is not discarded.
 * Each desired-state job reads fresh committed node/configuration state, not an optimistic
 * model or historical job payload. Ancestors are selected before dependents, and subsequent
 * work reads acknowledged associations. Hunts need nonempty `googleFolderId`, `indexId`,
 * and `allPuzzlesRoleId`, plus an available index category and all-puzzles role in that
 * guild, before node provisioning or derived sends. Resource setup is outside this worker.
 *
 * Provisioning reuses {@link provisionDiscordResources} with confirmed-ID checkpoints
 * and {@link createGoogleSheet}. Confirmed associations complete through
 * the trusted store, not general document writes. Periodic {@link syncCurrentNode} calls
 * share full Fluid resync's channel/embed/permission logic, including old/new parent
 * membership, puzzle category movement, ancestor permissions, and repair after a crash
 * between completion and derived sync. These passes neither create missing associations
 * themselves nor synthesize historical logs.
 *
 * Add/solve/status events retain distinct payloads and delivery acknowledgements in order.
 * Puzzle-add events retain the enqueue-time parent name even if the round is later removed.
 * Events without configured logging are acknowledged without sending. Solve/status logging
 * remains in the Fluid commands; PostgreSQL command wiring must not also send those direct
 * logs. Deletion tombstones proceed independently of backed-off log delivery: recorded Discord
 * IDs are deleted idempotently, while Google Sheets are always retained.
 *
 * External effects are not exactly-once. Confirmed resource IDs belong to their job and
 * are reused on retries. Timeouts, lost responses, and missing checkpoints are retried
 * with backoff; duplicate resources/messages without a recorded result are acceptable.
 * Humans can clean them up. Stale completions cannot overwrite manual/newer associations;
 * rejected results remain recorded on the original job. Deletion cancels its jobs, and a
 * replacement node's jobs never reuse their results. There is no setup ledger or resume CLI.
 *
 * @example
 * ```ts
 * const worker = createDurableIntegrationWorker({
 *     documents: new PostgresPuzzlehuntStore(pool),
 *     integrations: new PostgresHuntIntegrationStore(pool),
 *     authorizedGuildIds: configuredGuildIds,
 *     getGuild: loadAuthorizedGuild,
 *     onError: (error, scope) => console.error(scope, error),
 * });
 * await worker.start(); // One bounded startup pass, then non-overlapping periodic passes.
 * // await worker.reconcile(); // Explicit bounded catch-up; joins an in-flight pass.
 * await worker.stop(); // Stop admission, settle current work, release database ownership.
 * ```
 */
export class DurableIntegrationWorker {
	private readonly guilds: readonly string[];
	private readonly huntCursors = new Map<string, string>();
	private readonly nodeCursors = new Map<string, string>();
	private current: Promise<void> | undefined;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private running = false;
	private stopping = false;
	private readonly interval: number;
	private readonly hunts: number;
	private readonly jobs: number;
	private readonly events: number;
	private readonly nodes: number;
	private readonly retryBase: number;
	private readonly retryMax: number;

	constructor(private readonly options: DurableIntegrationWorkerOptions) {
		this.guilds = [...new Set(options.authorizedGuildIds)];
		if (this.guilds.some((id) => !id))
			throw new Error('Authorized guild IDs must not be empty.');
		const positive = (value: number, maximum = Number.MAX_SAFE_INTEGER) => {
			if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
				throw new Error(
					'Worker limits and intervals must be positive bounded integers.'
				);
			}
			return value;
		};
		this.interval = positive(options.intervalMs ?? 30000, 2147483647);
		this.hunts = positive(options.huntsPerGuild ?? 10, 1000);
		this.jobs = positive(options.jobsPerHunt ?? 50, 1000);
		this.events = positive(options.eventsPerHunt ?? 50, 1000);
		this.nodes = positive(options.nodesPerHunt ?? 50, 1000);
		this.retryBase = positive(options.retryBaseMs ?? 30000);
		this.retryMax = positive(options.retryMaxMs ?? 3600000);
	}

	/** Await the first bounded catch-up pass, then schedule non-overlapping passes. */
	public async start(): Promise<void> {
		if (this.running) return;
		this.running = true;
		this.stopping = false;
		try {
			await this.reconcile();
		} catch (error) {
			this.running = false;
			throw error;
		}
		this.schedule();
	}

	private schedule(): void {
		if (!this.running) return;
		this.timer = setTimeout(() => {
			void this.reconcile()
				.catch((error) => this.options.onError(asError(error)))
				.finally(() => this.schedule());
		}, this.interval);
	}

	/** Stops admission, settles in-flight external operations/checkpoints, and releases ownership. */
	public async stop(): Promise<void> {
		this.running = false;
		this.stopping = true;
		if (this.timer !== undefined) clearTimeout(this.timer);
		await this.current;
	}

	/** A bounded one-shot pass; overlapping calls join the same pass. No hints/cache are required. */
	public reconcile(): Promise<void> {
		if (this.current) return this.current;
		if (this.stopping)
			return Promise.reject(
				new Error(
					'Worker stopped; call start before reconciling again.'
				)
			);
		this.current = this.scan().finally(() => {
			this.current = undefined;
		});
		return this.current;
	}

	private async scan(): Promise<void> {
		for (const guildId of this.guilds) {
			if (this.stopping) break;
			const scopes = await this.options.integrations.discover(
				guildId,
				this.huntCursors.get(guildId),
				this.hunts
			);
			for (const scope of scopes) {
				if (this.stopping) break;
				try {
					await this.processHunt(scope);
				} catch (error) {
					this.options.onError(asError(error), scope);
				}
				this.huntCursors.set(guildId, scope.huntId);
			}
			if (scopes.length < this.hunts) this.huntCursors.delete(guildId);
		}
	}

	private retryDelay(attempts: number): number {
		return Math.min(
			this.retryMax,
			this.retryBase * 2 ** Math.min(attempts, 20)
		);
	}

	private context(
		snapshot: HuntSnapshot,
		guild: Guild
	): PuzzlehuntSyncContext {
		const { googleFolderId, indexId, allPuzzlesRoleId } =
			snapshot.document.configuration;
		if (!googleFolderId || !indexId || !allPuzzlesRoleId) {
			throw new Error(
				'Hunt is not configured: googleFolderId, indexId and allPuzzlesRoleId are required.'
			);
		}
		if (
			guild.channels.cache.get(indexId)?.type !==
				ChannelType.GuildCategory ||
			!guild.roles.cache.has(allPuzzlesRoleId)
		) {
			throw new Error(
				'Configured index category or all-puzzles role is unavailable in this guild.'
			);
		}
		return {
			puzzlehunt: new PuzzlehuntModel(this.options.documents, snapshot),
			googleFolderId,
			indexId,
			allPuzzlesRoleId,
		};
	}

	private ancestorsReady(
		snapshot: HuntSnapshot,
		node: DocumentNode
	): boolean {
		let parentId = node.parentId;
		while (parentId !== undefined) {
			const parent = snapshot.document.nodes[parentId];
			if (!parent?.discord) return false;
			parentId = parent.parentId;
		}
		return true;
	}

	private async processHunt(scope: HuntScope): Promise<void> {
		const owned = await this.options.integrations.acquire(scope);
		if (owned === undefined) return;
		try {
			const guild = await this.options.getGuild(scope.guildId);
			if (guild.id !== scope.guildId)
				throw new Error(
					'Discord guild does not match the authorized scope.'
				);
			const jobs = await owned.dueJobs(this.jobs);
			for (const job of jobs) {
				if (this.stopping) break;
				await this.processJob(owned, guild, job);
			}
			let processed = 0;
			while (processed < this.events && !this.stopping) {
				const events = await owned.dueEvents(this.events - processed);
				if (events.length === 0) break;
				for (const event of events) {
					if (this.stopping) break;
					await this.processEvent(owned, guild, event);
					processed++;
				}
			}
			if (!this.stopping) await this.reconcileNodes(owned, guild);
		} finally {
			await owned.release();
		}
	}

	private async processJob(
		owned: OwnedHuntIntegrations,
		guild: Guild,
		job: IntegrationJob
	): Promise<void> {
		if (!(await owned.startJob(job.id))) return;
		try {
			const snapshot = await this.options.documents.read(owned.scope);
			const node = snapshot.document.nodes[job.nodeId];
			const existing =
				node &&
				(job.target === 'discord'
					? node.discord
					: node.type === 'puzzle' && node.sheetId);
			if (
				!node ||
				existing ||
				job.hadAssociation ||
				(job.target === 'google' && node.type !== 'puzzle')
			) {
				await this.options.integrations.completeWork(
					owned.scope,
					job.id
				);
				return;
			}
			const result = await this.provisionJob(
				owned,
				guild,
				job,
				snapshot,
				node
			);
			await this.options.integrations.completeWork(
				owned.scope,
				job.id,
				result
			);
			// Each subsequent job and reconciliation reads a new committed snapshot, not this model.
		} catch (error) {
			const message = `${job.target} job ${job.id} (node ${
				job.nodeId
			}): ${asError(error).message}`;
			this.options.onError(
				new Error(message, { cause: error }),
				owned.scope
			);
			await owned.failJob(job.id, message, this.retryDelay(job.attempts));
		}
	}

	private async provisionJob(
		owned: OwnedHuntIntegrations,
		guild: Guild,
		job: IntegrationJob,
		snapshot: HuntSnapshot,
		node: DocumentNode
	): Promise<HuntIntegrationCommand> {
		const context = this.context(snapshot, guild);
		if (job.target === 'google') {
			let sheetId = job.confirmed.sheet;
			if (sheetId === undefined) {
				sheetId = await (this.options.createSheet ?? createGoogleSheet)(
					node.name,
					context.googleFolderId,
					{ timeout: 30000 }
				);
				await owned.confirmResource(job.id, 'sheet', sheetId);
			}
			return {
				type: 'set-property',
				nodeId: node.id,
				property: 'sheetId',
				value: sheetId,
			};
		}

		if (!this.ancestorsReady(snapshot, node)) {
			throw new Error(
				'Waiting for committed ancestor Discord associations.'
			);
		}
		const current =
			node.type === 'round'
				? context.puzzlehunt.getRound(node.id)
				: context.puzzlehunt.getPuzzle(node.id);
		const ids = await provisionDiscordResources(context, guild, current, {
			existing: job.confirmed,
			onCreated: (resource, id) =>
				owned.confirmResource(job.id, resource, id),
		});
		// Raw provisioning returns string IDs; the shared Fluid helper also accepts SDK objects.
		const id = (value: string | { id: string }) =>
			snowflake(typeof value === 'string' ? value : value.id);
		return {
			type: 'set-property',
			nodeId: node.id,
			property: 'discord',
			value: {
				channelId: id(ids.channel),
				roleId: id(ids.role),
				...('indexChannel' in ids
					? { indexChannelId: id(ids.indexChannel) }
					: {}),
			},
		};
	}

	private async processEvent(
		owned: OwnedHuntIntegrations,
		guild: Guild,
		item: IntegrationEvent
	): Promise<void> {
		try {
			await owned.startEvent(item);
			const { event } = item.payload;
			let messageId: string | undefined;
			if (event.type === 'node-deleted') {
				await removeDiscordAssociation(guild, event.node);
			} else {
				const log = await this.eventLog(owned.scope, item.payload);
				if (log !== undefined) {
					const channel = guild.channels.cache.get(log.channelId);
					if (!channel?.isTextBased())
						throw new Error(
							`Logging channel ${log.channelId} is unavailable.`
						);
					messageId = (await channel.send(log.content)).id;
				}
			}
			await owned.completeEvent(item, messageId);
		} catch (error) {
			const message = `Event ${item.commandId}/${item.ordinal}: ${
				asError(error).message
			}`;
			this.options.onError(
				new Error(message, { cause: error }),
				owned.scope
			);
			await owned.failEvent(
				item,
				message,
				this.retryDelay(item.attempts)
			);
		}
	}

	private async eventLog(
		scope: HuntScope,
		{ event, configuration, parentName }: IntegrationEvent['payload']
	): Promise<{ channelId: string; content: string } | undefined> {
		const channels = configuration.loggingChannelIds;
		if (!channels) return undefined;
		switch (event.type) {
			case 'node-added': {
				if (event.node.type !== 'puzzle') return undefined;
				// Older queued events may predate the parent-name payload field.
				const parent =
					parentName ??
					(await this.options.documents.read(scope)).document.nodes[
						event.node.parentId
					]?.name;
				if (parent === undefined) {
					throw new Error(
						'Puzzle-add event has no recorded or surviving parent name.'
					);
				}
				return {
					channelId: channels.puzzleAdd,
					content: puzzleAddedMessage(parent, event.node.name),
				};
			}
			case 'puzzle-solved':
				return event.node.answer === undefined
					? undefined
					: {
							channelId: channels.puzzleSolve,
							content: puzzleSolvedMessage(
								event.node.name,
								event.node.answer
							),
					  };
			case 'puzzle-status-updated':
				return {
					channelId: channels.puzzleStatusUpdate,
					content: puzzleStatusMessage(
						event.node.name,
						event.node.status
					),
				};
			case 'node-deleted':
				return undefined;
		}
	}

	private async reconcileNodes(
		owned: OwnedHuntIntegrations,
		guild: Guild
	): Promise<void> {
		const snapshot = await this.options.documents.read(owned.scope);
		// Incomplete seed hunts must not start external work, including derived sends.
		this.context(snapshot, guild);
		const cursor = this.nodeCursors.get(owned.scope.huntId);
		const ids = Object.keys(snapshot.document.nodes)
			.sort()
			.filter((id) => cursor === undefined || id > cursor)
			.slice(0, this.nodes);
		for (const id of ids) {
			if (this.stopping) break;
			try {
				const fresh = await this.options.documents.read(owned.scope);
				const node = fresh.document.nodes[id];
				if (!node?.discord || !this.ancestorsReady(fresh, node))
					continue;
				const context = this.context(fresh, guild);
				await owned.assertOwnership();
				await syncCurrentNode(
					context,
					guild,
					node.type === 'round'
						? context.puzzlehunt.getRound(id)
						: context.puzzlehunt.getPuzzle(id)
				);
			} catch (error) {
				this.options.onError(
					new Error(
						`Reconciliation for node ${id}: ${
							asError(error).message
						}`,
						{ cause: error }
					),
					owned.scope
				);
			} finally {
				this.nodeCursors.set(owned.scope.huntId, id);
			}
		}
		if (ids.length < this.nodes)
			this.nodeCursors.delete(owned.scope.huntId);
	}
}

export function createDurableIntegrationWorker(
	options: DurableIntegrationWorkerOptions
): DurableIntegrationWorker {
	return new DurableIntegrationWorker(options);
}

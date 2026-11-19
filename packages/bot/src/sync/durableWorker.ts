import { ChannelType, DiscordAPIError, type Guild } from 'discord.js';
import { PuzzlehuntModel } from '@belle-puzzles/puzzlehunt-model/model';
import {
	HuntCommandError,
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
	type IntegrationProgress,
	type IntegrationProgressTarget,
	type OwnedHuntIntegrations,
	type PostgresHuntIntegrationStore,
} from '@belle-puzzles/puzzlehunt-model/postgres';
import { createGoogleSheet } from '../integrations/google.js';
import {
	provisionDiscordResources,
	removeDiscordAssociation,
	syncCurrentNode,
	type PuzzlehuntSyncContext,
	type SyncMessageDelivery,
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
 * {@link getGuild} must return the authorized guild with role/channel caches populated
 * and a client configured with `rest: { retries: 0 }`. SDK transport retries can duplicate
 * creates/sends after lost responses, so the worker refuses automatic retries. Google
 * copies disable transport retries and use a 30-second request timeout. A separate local
 * client can keep the deployed Fluid client's configuration unchanged.
 *
 * Batch sizes are 1-1000. Defaults per pass are 10 hunts per guild, 50 jobs, 50 events,
 * and 50 reconciliation nodes per hunt, at 30-second intervals. Known no-effect failures
 * use persisted attempts/errors/due times with a 30-second retry base and one-hour cap.
 * Selected Discord 4xx responses are recognized; other errors pause unless
 * {@link isKnownNoEffect} proves that the external service performed no operation.
 * Never classify timeouts or failed checkpoints as safe.
 *
 * {@link createSheet} is injectable for tests. Worker tests use disposable native
 * PostgreSQL and mocked Discord/Google operations, not real services or secrets.
 */
export interface DurableIntegrationWorkerOptions {
	readonly integrations: PostgresHuntIntegrationStore;
	/** Must read committed state; never pass a mutable/optimistic model. */
	readonly documents: HuntDocumentClient;
	readonly authorizedGuildIds: readonly string[];
	/** Return a loaded guild from an authorized client configured with rest: { retries: 0 }. */
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
	/**
	 * Only true when the service definitively rejected a create/send without a side effect.
	 * Timeouts, lost responses and failed persistence are NOT safe retries.
	 */
	readonly isKnownNoEffect?: (error: unknown) => boolean;
}

class PausedIntegrationError extends Error {}

const asError = (error: unknown): Error =>
	error instanceof Error ? error : new Error(String(error));

function requireProgress(
	progress: IntegrationProgress | undefined,
	workId: string | null
): void {
	if (progress === undefined) return;
	if (
		progress.blockedError ||
		progress.pending.length > 0 ||
		progress.workId !== workId
	) {
		throw new PausedIntegrationError(
			`Manual inspection required in integration_progress: ${
				progress.blockedError ??
				(progress.pending.length > 0
					? `unconfirmed operations ${progress.pending.join(', ')}`
					: 'resources belong to an earlier work item')
			}. Confirmed IDs: ${JSON.stringify(progress.confirmed)}`
		);
	}
	if (!progress.due)
		throw new Error(
			'Integration operation is waiting for its persisted retry time.'
		);
}

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
 * Provisioning reuses {@link provisionDiscordResources} with intent/result/failure
 * checkpoints and {@link createGoogleSheet}. Confirmed associations complete through
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
 * logs. Deletion tombstones proceed independently of blocked log delivery: recorded Discord
 * IDs are deleted idempotently, while Google Sheets are always retained.
 *
 * External effects are not exactly-once. Persisted intent precedes each create/send,
 * including the requested name and destination IDs for manual inspection. Confirmed
 * resource/message IDs are reused, including an embed sent but not yet pinned. Timeouts,
 * lost responses, interrupted intents, and unacknowledged sends pause the node/target or
 * log stream with manual-inspection diagnostics instead of repeating the effect. Later
 * jobs cannot bypass that pause. Stale completions cannot overwrite manual/newer
 * associations; confirmed but rejected results remain recorded. Node deletion retains
 * and blocks progress even if a replacement reuses the ID. There is deliberately no setup
 * ledger, automatic adoption, or general resume CLI.
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

	private knownNoEffect(error: unknown): boolean {
		return (
			this.options.isKnownNoEffect?.(error) === true ||
			(error instanceof DiscordAPIError &&
				[400, 401, 403, 404, 429].includes(error.status))
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
			if (guild.client.rest.options.retries !== 0) {
				throw new Error(
					'Durable workers require Discord REST retries: 0; automatic transport retries can duplicate creates/sends.'
				);
			}
			const jobs = await owned.dueJobs(this.jobs);
			for (const job of jobs) {
				if (this.stopping) break;
				await this.processJob(owned, guild, job);
			}
			for (
				let processed = 0;
				processed < this.events && !this.stopping;

			) {
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

	private async creationFailed(
		owned: OwnedHuntIntegrations,
		nodeId: string,
		target: IntegrationProgressTarget,
		resource: string,
		error: unknown
	): Promise<void> {
		if (this.knownNoEffect(error)) {
			const progress = await owned.progress(nodeId, target);
			await owned.retryOperation(
				nodeId,
				target,
				resource,
				asError(error).message,
				this.retryDelay(progress?.attempts ?? 0)
			);
		} else {
			const message = `Uncertain ${target}/${resource}: ${
				asError(error).message
			}. Inspect external resources before retrying.`;
			await owned.blockProgress(nodeId, target, message);
			throw new PausedIntegrationError(message, { cause: error });
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
				const progress = await owned.progress(job.nodeId, job.target);
				if (progress && progress.workId === job.id) {
					await owned.blockProgress(
						job.nodeId,
						job.target,
						'Association already exists or node is gone. Inspect retained external results; no resources were recreated.'
					);
				}
				await this.options.integrations.completeWork(
					owned.scope,
					job.id
				);
				return;
			}
			const context = this.context(snapshot, guild);
			const progress = await owned.progress(node.id, job.target);
			requireProgress(progress, job.id);
			let result: HuntIntegrationCommand;
			if (job.target === 'discord') {
				if (!this.ancestorsReady(snapshot, node)) {
					throw new Error(
						'Waiting for committed ancestor Discord associations.'
					);
				}
				const current =
					node.type === 'round'
						? context.puzzlehunt.getRound(node.id)
						: context.puzzlehunt.getPuzzle(node.id);
				const ids = await provisionDiscordResources(
					context,
					guild,
					current,
					{
						existing: progress?.confirmed,
						onCreating: (resource) =>
							owned.beginOperation(
								node.id,
								job.target,
								resource,
								job.id,
								{
									name: node.name,
									indexId: context.indexId,
									parentChannelId:
										node.type === 'puzzle'
											? context.puzzlehunt.getRound(
													node.parentId
											  ).discord.channelId
											: undefined,
								}
							),
						onCreated: (resource, id) =>
							this.checkpoint(
								owned,
								node.id,
								job.target,
								resource,
								id
							),
						onCreateFailed: (resource, error) =>
							this.creationFailed(
								owned,
								node.id,
								job.target,
								resource,
								error
							),
					}
				);
				// Raw provisioning returns string IDs; the shared Fluid helper also accepts SDK objects.
				const id = (value: string | { id: string }) =>
					snowflake(typeof value === 'string' ? value : value.id);
				result = {
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
			} else {
				let sheetId = progress?.confirmed.sheet;
				if (sheetId === undefined) {
					await owned.beginOperation(
						node.id,
						'google',
						'sheet',
						job.id,
						{
							name: node.name,
							googleFolderId: context.googleFolderId,
						}
					);
					try {
						sheetId = await (
							this.options.createSheet ?? createGoogleSheet
						)(node.name, context.googleFolderId, {
							retry: false,
							timeout: 30000,
						});
					} catch (error) {
						await this.creationFailed(
							owned,
							node.id,
							'google',
							'sheet',
							error
						);
						throw error;
					}
					await this.checkpoint(
						owned,
						node.id,
						'google',
						'sheet',
						sheetId
					);
				}
				result = {
					type: 'set-property',
					nodeId: node.id,
					property: 'sheetId',
					value: sheetId,
				};
			}
			try {
				await this.options.integrations.completeWork(
					owned.scope,
					job.id,
					result
				);
			} catch (error) {
				if (error instanceof HuntCommandError) {
					await owned.blockProgress(
						node.id,
						job.target,
						`Association result rejected: ${error.message}. Inspect confirmed external IDs before resolving.`
					);
				}
				throw error;
			}
			// Each subsequent job and reconciliation reads a new committed snapshot, not this model.
		} catch (error) {
			const message = `${job.target} job ${job.id} (node ${
				job.nodeId
			}): ${asError(error).message}`;
			this.options.onError(
				new Error(message, { cause: error }),
				owned.scope
			);
			const progress = await owned.progress(job.nodeId, job.target);
			const pause =
				error instanceof PausedIntegrationError ||
				!!progress?.blockedError ||
				(progress?.pending.length ?? 0) > 0;
			if (pause && !progress?.blockedError)
				await owned.blockProgress(job.nodeId, job.target, message);
			await owned.failJob(
				job.id,
				message,
				this.retryDelay(job.attempts),
				pause
			);
		}
	}

	private async processEvent(
		owned: OwnedHuntIntegrations,
		guild: Guild,
		item: IntegrationEvent
	): Promise<void> {
		const { event, configuration, parentName } = item.payload;
		let sending = false;
		let confirmed = false;
		try {
			if (item.started)
				throw new PausedIntegrationError(
					'Unacknowledged log send; inspect the logging channel before retrying.'
				);
			await owned.startEvent(item);
			if (event.type === 'node-deleted') {
				await removeDiscordAssociation(guild, event.node);
			} else {
				let message: string | undefined;
				let channelId: string | undefined;
				if (
					event.type === 'node-added' &&
					event.node.type === 'puzzle'
				) {
					channelId = configuration.loggingChannelIds?.puzzleAdd;
					// Older queued events may predate the parent-name payload field.
					const parent =
						parentName ??
						(await this.options.documents.read(owned.scope))
							.document.nodes[event.node.parentId]?.name;
					if (channelId && parent === undefined)
						throw new Error(
							'Puzzle-add event has no recorded or surviving parent name.'
						);
					if (parent !== undefined)
						message = puzzleAddedMessage(parent, event.node.name);
				} else if (
					event.type === 'puzzle-solved' &&
					event.node.answer !== undefined
				) {
					channelId = configuration.loggingChannelIds?.puzzleSolve;
					message = puzzleSolvedMessage(
						event.node.name,
						event.node.answer
					);
				} else if (event.type === 'puzzle-status-updated') {
					channelId =
						configuration.loggingChannelIds?.puzzleStatusUpdate;
					message = puzzleStatusMessage(
						event.node.name,
						event.node.status
					);
				}
				if (message !== undefined && channelId !== undefined) {
					const channel = guild.channels.cache.get(channelId);
					if (!channel?.isTextBased())
						throw new Error(
							`Logging channel ${channelId} is unavailable.`
						);
					await owned.beginEventDelivery(item);
					sending = true;
					const sent = await channel.send(message);
					confirmed = true;
					try {
						await owned.completeEvent(item, sent.id);
					} catch (error) {
						throw new PausedIntegrationError(
							`Delivery acknowledgement failed for message ${sent.id}.`,
							{ cause: error }
						);
					}
					return;
				}
			}
			await owned.completeEvent(item);
		} catch (error) {
			const pause =
				item.started ||
				error instanceof PausedIntegrationError ||
				(sending && (confirmed || !this.knownNoEffect(error)));
			const message =
				`Event ${item.commandId}/${item.ordinal}: ${
					asError(error).message
				}` +
				(pause
					? ' Manual delivery inspection required; no automatic resend.'
					: '');
			this.options.onError(
				new Error(message, { cause: error }),
				owned.scope
			);
			await owned.failEvent(
				item,
				message,
				this.retryDelay(item.attempts),
				pause
			);
		}
	}

	private delivery(owned: OwnedHuntIntegrations): SyncMessageDelivery {
		return async (node, channel, content) => {
			const progress = await owned.progress(node.id, 'embed');
			requireProgress(progress, null);
			const existing = progress?.confirmed[channel.id];
			if (existing !== undefined) {
				const message = await channel.messages.fetch(existing);
				await message.edit(content);
				return message;
			}
			await owned.beginOperation(node.id, 'embed', channel.id, null, {
				name: node.name,
				channelId: channel.id,
			});
			let message;
			try {
				message = await channel.send(content);
			} catch (error) {
				await this.creationFailed(
					owned,
					node.id,
					'embed',
					channel.id,
					error
				);
				throw error;
			}
			await this.checkpoint(
				owned,
				node.id,
				'embed',
				channel.id,
				message.id
			);
			return message;
		};
	}

	private async checkpoint(
		owned: OwnedHuntIntegrations,
		nodeId: string,
		target: IntegrationProgressTarget,
		resource: string,
		id: string
	): Promise<void> {
		try {
			await owned.confirmOperation(nodeId, target, resource, id);
		} catch (error) {
			throw new Error(
				`Checkpoint failed for ${target}/${resource}, confirmed external ID ${id}.`,
				{ cause: error }
			);
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
				requireProgress(await owned.progress(id, 'embed'), null);
				await syncCurrentNode(
					context,
					guild,
					node.type === 'round'
						? context.puzzlehunt.getRound(id)
						: context.puzzlehunt.getPuzzle(id),
					this.delivery(owned)
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

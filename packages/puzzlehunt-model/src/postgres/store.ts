import {
	applyHuntCommand,
	validateHuntDocument,
	HuntCommandError,
	isUuid,
	snowflake,
} from '../document.js';
import type {
	DocumentDiscordAssociation,
	DocumentNode,
	HuntCommand,
	HuntCommandRequest,
	HuntCommandResult,
	HuntCommandUpdateResult,
	HuntConfiguration,
	HuntDocument,
	HuntDocumentClient,
	HuntIntegrationCommand,
	HuntScope,
	HuntSnapshot,
	HuntStateUpdate,
} from '../document.js';

const retainedChangeRevisions = 1000;

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

export type HuntIntegrationTarget = 'discord' | 'google';

interface HuntRow extends Record<string, unknown> {
	id: string;
	guild_id: string;
	name: string;
	schema_version: number;
	revision: string;
	configuration: HuntConfiguration;
	nodes: HuntNodeRow[];
}

interface HuntNodeRow extends Record<string, unknown> {
	id: string;
	type: 'round' | 'puzzle';
	name: string;
	url: string;
	parent_id: string | null;
	position: number;
	answer: string | null;
	status: string | null;
	last_status_update: number | null;
	sheet_id: string | null;
	discord_channel_id: string | null;
	discord_role_id: string | null;
	discord_index_channel_id: string | null;
}

function nodeFromRow(row: HuntNodeRow): DocumentNode {
	let discord: DocumentDiscordAssociation | undefined;
	if (row.discord_channel_id !== null) {
		if (row.discord_role_id === null) {
			throw new Error('Stored Discord association has no role.');
		}
		discord = {
			channelId: snowflake(row.discord_channel_id),
			roleId: snowflake(row.discord_role_id),
			...(row.discord_index_channel_id === null
				? {}
				: { indexChannelId: snowflake(row.discord_index_channel_id) }),
		};
	}
	const common = {
		id: row.id,
		name: row.name,
		url: row.url,
		position: row.position,
		...(discord === undefined ? {} : { discord }),
	};
	if (row.type === 'round') {
		return { ...common, type: 'round', parentId: row.parent_id };
	}
	if (row.parent_id === null) {
		throw new Error('Stored puzzle has no parent round.');
	}
	return {
		...common,
		type: 'puzzle',
		parentId: row.parent_id,
		...(row.answer === null ? {} : { answer: row.answer }),
		...(row.status === null ? {} : { status: row.status }),
		...(row.last_status_update === null
			? {}
			: { lastStatusUpdate: row.last_status_update }),
		...(row.sheet_id === null ? {} : { sheetId: row.sheet_id }),
	};
}

function snapshotFromRow(row: HuntRow): HuntSnapshot {
	if (row.schema_version !== 1) {
		throw new Error(
			`Unsupported hunt schema version: ${row.schema_version}`
		);
	}
	const revision = Number(row.revision);
	if (!Number.isSafeInteger(revision) || revision < 0) {
		throw new Error(`Invalid hunt revision: ${row.revision}`);
	}
	const nodes: Record<string, DocumentNode> = {};
	const document: HuntDocument = {
		name: row.name,
		configuration: row.configuration,
		nodes,
	};
	try {
		for (const node of row.nodes) {
			nodes[node.id] = nodeFromRow(node);
		}
		validateHuntDocument(document);
	} catch (error) {
		throw new Error('Stored hunt document failed validation.', {
			cause: error,
		});
	}
	return {
		huntId: row.id,
		guildId: snowflake(row.guild_id),
		schemaVersion: row.schema_version,
		revision,
		document,
	};
}

const snapshotQuery = `SELECT h.id, h.guild_id, h.name, h.schema_version, h.revision::text, h.configuration,
	(SELECT COALESCE(jsonb_agg(n ORDER BY n.id), '[]'::jsonb)
	 FROM hunt_nodes n WHERE n.hunt_id = h.id) AS nodes
	FROM hunts h`;

const queries = {
	read: {
		snapshotByScope: `${snapshotQuery} WHERE h.id = $1 AND h.guild_id = $2`,
		activeSnapshotByGuildId: `${snapshotQuery}
			JOIN active_hunts a ON a.hunt_id = h.id AND a.guild_id = h.guild_id
			WHERE a.guild_id = $1`,
		latestRevisionByScope:
			'SELECT revision::text FROM hunts WHERE id = $1 AND guild_id = $2',
	},
};

async function readSnapshot(
	connection: HuntDatabaseConnection,
	scope: HuntScope
): Promise<HuntSnapshot> {
	const { rows } = await connection.query<HuntRow>(
		queries.read.snapshotByScope,
		[scope.huntId, scope.guildId]
	);
	if (rows.length === 0) {
		throw new HuntCommandError(
			'not-found',
			'Hunt not found in this guild.'
		);
	}
	return snapshotFromRow(rows[0]);
}

async function writeDocumentChanges(
	connection: HuntDatabaseConnection,
	huntId: string,
	before: HuntDocument,
	after: HuntDocument
): Promise<string[]> {
	const removed = Object.keys(before.nodes).filter(
		(id) => after.nodes[id] === undefined
	);
	if (removed.length > 0) {
		await connection.query(
			`DELETE FROM hunt_nodes WHERE hunt_id = $1 AND id = ANY($2::uuid[])`,
			[huntId, removed]
		);
	}
	const changed = Object.values(after.nodes).filter(
		(node) => node !== before.nodes[node.id]
	);
	if (changed.length === 0) {
		return removed;
	}
	const values = changed.map((node) => ({
		id: node.id,
		type: node.type,
		name: node.name,
		url: node.url,
		parent_id: node.parentId,
		position: node.position,
		answer: node.type === 'puzzle' ? node.answer ?? null : null,
		status: node.type === 'puzzle' ? node.status ?? null : null,
		last_status_update:
			node.type === 'puzzle' ? node.lastStatusUpdate ?? null : null,
		sheet_id: node.type === 'puzzle' ? node.sheetId ?? null : null,
		discord_channel_id: node.discord?.channelId ?? null,
		discord_role_id: node.discord?.roleId ?? null,
		discord_index_channel_id: node.discord?.indexChannelId ?? null,
	}));
	// JSON is only a batch parameter here; each node is stored in typed SQL columns.
	await connection.query(
		`INSERT INTO hunt_nodes (
			hunt_id, id, type, name, url, parent_id, position, answer, status,
			last_status_update, sheet_id, discord_channel_id, discord_role_id, discord_index_channel_id
		 )
		 SELECT $1::uuid, n.id, n.type, n.name, n.url, n.parent_id, n.position,
			n.answer, n.status, n.last_status_update, n.sheet_id,
			n.discord_channel_id, n.discord_role_id, n.discord_index_channel_id
		 FROM jsonb_to_recordset($2::jsonb) AS n(
			id uuid, type text, name text, url text, parent_id uuid, position bigint,
			answer text, status text, last_status_update bigint, sheet_id text,
			discord_channel_id text, discord_role_id text, discord_index_channel_id text
		 )
		 ON CONFLICT (hunt_id, id) DO UPDATE SET
			name = EXCLUDED.name, url = EXCLUDED.url, parent_id = EXCLUDED.parent_id,
			position = EXCLUDED.position, answer = EXCLUDED.answer, status = EXCLUDED.status,
			last_status_update = EXCLUDED.last_status_update, sheet_id = EXCLUDED.sheet_id,
			discord_channel_id = EXCLUDED.discord_channel_id, discord_role_id = EXCLUDED.discord_role_id,
			discord_index_channel_id = EXCLUDED.discord_index_channel_id`,
		[huntId, JSON.stringify(values)]
	);
	return [...removed, ...changed.map((node) => node.id)];
}

function validateRevision(revision: number): void {
	if (!Number.isSafeInteger(revision) || revision < 0) {
		throw new HuntCommandError(
			'invalid-command',
			'Invalid synchronization revision.'
		);
	}
}

function validateScope(scope: HuntScope): void {
	if (!isUuid(scope.huntId) || !scope.guildId) {
		throw new HuntCommandError('invalid-command', 'Invalid hunt scope.');
	}
}

export class PostgresPuzzlehuntStore implements HuntDocumentClient {
	constructor(private readonly pool: HuntDatabasePool) {}

	/** Resolve selection and document in one MVCC snapshot, after guild authorization. */
	public async readActive(guildId: string): Promise<HuntSnapshot> {
		if (!guildId) {
			throw new HuntCommandError('invalid-command', 'Invalid guild ID.');
		}

		return await this.#withConnection(async (connection) => {
			const { rows } = await connection.query<HuntRow>(
				queries.read.activeSnapshotByGuildId,
				[guildId]
			);
			if (rows.length === 0) {
				throw new HuntCommandError(
					'not-found',
					'No active hunt in this guild.'
				);
			}
			return snapshotFromRow(rows[0]);
		});
	}

	/** The caller must authorize the guild/hunt scope before invoking the store. */
	public async read(scope: HuntScope): Promise<HuntSnapshot> {
		validateScope(scope);
		return await this.#withConnection(
			async (connection) => await readSnapshot(connection, scope)
		);
	}

	async #withConnection<TReturn>(
		cb: (connection: HuntDatabaseConnection) => Promise<TReturn>
	): Promise<TReturn> {
		const connection = await this.pool.connect();
		try {
			return await cb(connection);
		} finally {
			connection.release();
		}
	}

	public async readRevision(scope: HuntScope): Promise<number> {
		validateScope(scope);
		return await this.#withConnection(async (connection) => {
			const { rows } = await connection.query<{ revision: string }>(
				queries.read.latestRevisionByScope,
				[scope.huntId, scope.guildId]
			);
			if (rows.length === 0) {
				throw new HuntCommandError(
					'not-found',
					'Hunt not found in this guild.'
				);
			}
			const revision = Number(rows[0].revision);
			validateRevision(revision);
			return revision;
		});
	}

	public async readUpdates(
		scope: HuntScope,
		baseRevision: number
	): Promise<HuntStateUpdate> {
		validateScope(scope);
		validateRevision(baseRevision);
		return await this.#withConnection(async (connection) => {
			// Coverage, metadata, after-images and deletions share one MVCC snapshot.
			const { rows } = await connection.query<
				HuntRow & {
					complete: boolean;
					deleted_node_ids: string[];
				}
			>(
				`WITH scoped AS (
					SELECT * FROM hunts WHERE id = $1 AND guild_id = $2
				 ), coverage AS (
					SELECT h.*, ($3::bigint <= h.revision AND
						(SELECT count(*) FROM hunt_changes c
						 WHERE c.hunt_id = h.id AND c.revision > $3 AND c.revision <= h.revision)
						= h.revision - $3::bigint) AS complete
					FROM scoped h
				 ), affected AS (
					SELECT DISTINCT unnest(c.node_ids) AS id FROM hunt_changes c
					JOIN coverage h ON h.id = c.hunt_id
					WHERE h.complete AND c.revision > $3 AND c.revision <= h.revision
				 )
				 SELECT h.id, h.guild_id, h.name, h.schema_version, h.revision::text,
					h.configuration, h.complete,
					(SELECT COALESCE(jsonb_agg(n ORDER BY n.id), '[]'::jsonb)
					 FROM hunt_nodes n WHERE n.hunt_id = h.id
					 AND (NOT h.complete OR n.id IN (SELECT id FROM affected))) AS nodes,
					ARRAY(SELECT a.id FROM affected a WHERE NOT EXISTS
						(SELECT 1 FROM hunt_nodes n WHERE n.hunt_id = h.id AND n.id = a.id)
						ORDER BY a.id) AS deleted_node_ids
				 FROM coverage h`,
				[scope.huntId, scope.guildId, baseRevision]
			);
			if (rows.length === 0) {
				throw new HuntCommandError(
					'not-found',
					'Hunt not found in this guild.'
				);
			}
			const row = rows[0];
			if (!row.complete) {
				return { type: 'snapshot', snapshot: snapshotFromRow(row) };
			}
			if (row.schema_version !== 1) {
				throw new Error(
					`Unsupported hunt schema version: ${row.schema_version}`
				);
			}
			return {
				type: 'delta',
				delta: {
					huntId: row.id,
					guildId: snowflake(row.guild_id),
					schemaVersion: 1,
					baseRevision,
					revision: Number(row.revision),
					name: row.name,
					configuration: row.configuration,
					upsertNodes: row.nodes.map(nodeFromRow),
					deletedNodeIds: row.deleted_node_ids,
				},
			};
		});
	}

	public submit(
		scope: HuntScope,
		request: HuntCommandRequest
	): Promise<HuntCommandResult> {
		return this.commit(scope, request.commandId, request.command);
	}

	public async submitUpdates(
		scope: HuntScope,
		request: HuntCommandRequest,
		baseRevision: number
	): Promise<HuntCommandUpdateResult> {
		validateRevision(baseRevision);
		const result = await this.submit(scope, request);
		// A later consistent read may include newer writes; the original receipt stays intact.
		try {
			const update = await this.readUpdates(scope, baseRevision);
			return {
				receipt: result.receipt,
				replayed: result.replayed,
				update,
			};
		} catch (error) {
			// Even a not-found read is not a rejection of the already committed command.
			throw new Error(
				'Hunt command committed but its synchronization response failed.',
				{ cause: error }
			);
		}
	}

	/** Keep this method behind a worker-only service boundary. */
	public submitIntegration(
		scope: HuntScope,
		commandId: string,
		command: HuntIntegrationCommand
	): Promise<HuntCommandResult> {
		return this.commit(scope, commandId, command);
	}

	/** A worker may only clear the exact generation it reconciled. */
	public async acknowledgeReconciliation(
		scope: HuntScope,
		target: HuntIntegrationTarget,
		requestedRevision: number
	): Promise<boolean> {
		validateScope(scope);
		return await this.#withConnection(async (connection) => {
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

	async #tryGetExistingReceipt(
		scope: HuntScope,
		commandId: string,
		// json stringified HuntIntegrationCommand or HuntCommand
		encodedCommand: string,
		connection: HuntDatabaseConnection
	): Promise<HuntCommandResult['receipt'] | undefined> {
		const { rows: receipts } = await connection.query<{
			committed_revision: string;
			matches: boolean;
		}>(
			`SELECT committed_revision::text, command = $3::jsonb AS matches
				 FROM command_receipts WHERE hunt_id = $1 AND command_id = $2`,
			[scope.huntId, commandId, encodedCommand]
		);
		if (receipts.length > 0) {
			const receipt = receipts[0];
			if (!receipt.matches) {
				throw new HuntCommandError(
					'conflict',
					'Command ID was already used for a different command.'
				);
			}

			return {
				commandId,
				committedRevision: Number(receipt.committed_revision),
			};
		}
		return undefined;
	}

	private async commit(
		scope: HuntScope,
		commandId: string,
		command: HuntCommand | HuntIntegrationCommand
	): Promise<HuntCommandResult> {
		validateScope(scope);
		if (!isUuid(commandId)) {
			throw new HuntCommandError(
				'invalid-command',
				'Command IDs must be lowercase UUIDs.'
			);
		}
		const connection = await this.pool.connect();
		let transactionOpen = false;
		let releaseError: Error | undefined;
		try {
			await connection.query('BEGIN');
			transactionOpen = true;
			const { rows } = await connection.query<{ id: string }>(
				`SELECT id FROM hunts
				 WHERE id = $1 AND guild_id = $2 FOR UPDATE`,
				[scope.huntId, scope.guildId]
			);
			if (rows.length === 0) {
				throw new HuntCommandError(
					'not-found',
					'Hunt not found in this guild.'
				);
			}
			// A new statement after the lock wait reads the winner's committed node changes.
			const snapshot = await readSnapshot(connection, scope);

			const encodedCommand = JSON.stringify(command);
			let receipt = await this.#tryGetExistingReceipt(
				scope,
				commandId,
				encodedCommand,
				connection
			);
			if (receipt !== undefined) {
				await connection.query('COMMIT');
				transactionOpen = false;
				return {
					receipt,
					snapshot,
					replayed: true,
				};
			}

			const { rows: clock } = await connection.query<{ now_ms: string }>(
				`SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint::text AS now_ms`
			);
			const applied = applyHuntCommand(
				snapshot.document,
				command,
				Number(clock[0].now_ms)
			);
			const committed: HuntSnapshot = {
				...snapshot,
				revision: snapshot.revision + 1,
				document: applied.document,
			};
			const changedIds = await writeDocumentChanges(
				connection,
				scope.huntId,
				snapshot.document,
				committed.document
			);
			await connection.query(
				'INSERT INTO hunt_changes (hunt_id, revision, node_ids) VALUES ($1, $2, $3::uuid[])',
				[scope.huntId, committed.revision, changedIds]
			);
			await connection.query(
				'DELETE FROM hunt_changes WHERE hunt_id = $1 AND revision <= $2',
				[scope.huntId, committed.revision - retainedChangeRevisions]
			);
			await connection.query(
				`UPDATE hunts SET revision = $3, updated_at = clock_timestamp()
				 WHERE id = $1 AND guild_id = $2`,
				[scope.huntId, scope.guildId, committed.revision]
			);
			await connection.query(
				`INSERT INTO command_receipts (hunt_id, command_id, command, committed_revision)
				 VALUES ($1, $2, $3::jsonb, $4)`,
				[scope.huntId, commandId, encodedCommand, committed.revision]
			);
			await connection.query(
				`INSERT INTO integration_jobs (hunt_id, target, requested_revision)
				 VALUES ($1, 'discord', $2), ($1, 'google', $2)
				 ON CONFLICT (hunt_id, target) DO UPDATE
				 SET requested_revision = EXCLUDED.requested_revision`,
				[scope.huntId, committed.revision]
			);
			for (const [ordinal, event] of applied.events.entries()) {
				await connection.query(
					`INSERT INTO integration_events (hunt_id, command_id, ordinal, revision, payload)
					 VALUES ($1, $2, $3, $4, $5::jsonb)`,
					[
						scope.huntId,
						commandId,
						ordinal,
						committed.revision,
						JSON.stringify({
							event,
							configuration: committed.document.configuration,
						}),
					]
				);
			}

			// Notify listeners of the change. Emit just enough information for them to uniquely identify the change;
			// if they need to e.g. compute information about it they can read the change tables modified above.
			await connection.query(`SELECT pg_notify('hunt_changed', $1)`, [
				JSON.stringify({
					huntId: scope.huntId,
					revision: committed.revision,
				}),
			]);
			await connection.query('COMMIT');
			transactionOpen = false;
			return {
				receipt: { commandId, committedRevision: committed.revision },
				snapshot: committed,
				replayed: false,
			};
		} catch (error) {
			if (transactionOpen) {
				try {
					await connection.query('ROLLBACK');
				} catch (rollbackError) {
					releaseError = new AggregateError(
						[error, rollbackError],
						'Hunt command failed and its transaction could not be rolled back.'
					);
					throw releaseError;
				}
			}
			throw error;
		} finally {
			connection.release(releaseError);
		}
	}
}

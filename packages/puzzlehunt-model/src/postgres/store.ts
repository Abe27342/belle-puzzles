import {
	applyHuntCommand,
	assertHuntDocument,
	HuntCommandError,
	isDocumentId,
} from '../document.js';
import type {
	DocumentDiscordAssociation,
	DocumentNode,
	HuntCommand,
	HuntCommandRequest,
	HuntCommandResult,
	HuntConfiguration,
	HuntDocument,
	HuntDocumentClient,
	HuntIntegrationCommand,
	HuntScope,
	HuntSnapshot,
} from '../document.js';

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
			channelId: row.discord_channel_id,
			roleId: row.discord_role_id,
			...(row.discord_index_channel_id === null
				? {}
				: { indexChannelId: row.discord_index_channel_id }),
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
	try {
		for (const node of row.nodes) {
			nodes[node.id] = nodeFromRow(node);
		}
		assertHuntDocument({ nodes });
	} catch (error) {
		throw new Error('Stored hunt document failed validation.', {
			cause: error,
		});
	}
	return {
		huntId: row.id,
		guildId: row.guild_id,
		name: row.name,
		schemaVersion: row.schema_version,
		revision,
		configuration: row.configuration,
		document: { nodes },
	};
}

async function readSnapshot(
	connection: HuntDatabaseConnection,
	scope: HuntScope
): Promise<HuntSnapshot> {
	// One statement keeps hunt metadata and node rows on the same MVCC snapshot.
	const { rows } = await connection.query<HuntRow>(
		`SELECT h.id, h.guild_id, h.name, h.schema_version, h.revision::text, h.configuration,
		 (SELECT COALESCE(jsonb_agg(n ORDER BY n.id), '[]'::jsonb)
		  FROM hunt_nodes n WHERE n.hunt_id = h.id) AS nodes
		 FROM hunts h WHERE h.id = $1 AND h.guild_id = $2`,
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
): Promise<void> {
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
		return;
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
}

function validateScope(scope: HuntScope): void {
	if (!isDocumentId(scope.huntId) || !scope.guildId) {
		throw new HuntCommandError('invalid-command', 'Invalid hunt scope.');
	}
}

export class PostgresPuzzlehuntStore implements HuntDocumentClient {
	constructor(private readonly pool: HuntDatabasePool) {}

	/** The caller must authorize the guild/hunt scope before invoking the store. */
	public async read(scope: HuntScope): Promise<HuntSnapshot> {
		validateScope(scope);
		const connection = await this.pool.connect();
		try {
			return await readSnapshot(connection, scope);
		} finally {
			connection.release();
		}
	}

	public submit(
		scope: HuntScope,
		request: HuntCommandRequest
	): Promise<HuntCommandResult> {
		return this.commit(scope, request.commandId, request.command);
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
		const connection = await this.pool.connect();
		try {
			const { rows } = await connection.query<{ hunt_id: string }>(
				`DELETE FROM integration_jobs j USING hunts h
				 WHERE j.hunt_id = h.id AND h.id = $1 AND h.guild_id = $2
				 AND j.target = $3 AND j.requested_revision = $4
				 RETURNING j.hunt_id`,
				[scope.huntId, scope.guildId, target, requestedRevision]
			);
			return rows.length > 0;
		} finally {
			connection.release();
		}
	}

	private async commit(
		scope: HuntScope,
		commandId: string,
		command: HuntCommand | HuntIntegrationCommand
	): Promise<HuntCommandResult> {
		validateScope(scope);
		if (!isDocumentId(commandId)) {
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
				await connection.query('COMMIT');
				transactionOpen = false;
				return {
					receipt: {
						commandId,
						committedRevision: Number(receipt.committed_revision),
					},
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
			await writeDocumentChanges(
				connection,
				scope.huntId,
				snapshot.document,
				committed.document
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
							configuration: committed.configuration,
						}),
					]
				);
			}
			// A transactional wake-up hint; the tables above are the recovery record.
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

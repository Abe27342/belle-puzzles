import {
	applyHuntCommand,
	assertHuntDocument,
	HuntCommandError,
	isDocumentId,
} from '@belle-puzzles/puzzlehunt-model/document';
import type {
	HuntCommand,
	HuntCommandRequest,
	HuntCommandResult,
	HuntConfiguration,
	HuntDocument,
	HuntDocumentClient,
	HuntIntegrationCommand,
	HuntScope,
	HuntSnapshot,
} from '@belle-puzzles/puzzlehunt-model/document';

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
	document: HuntDocument;
}

const huntColumns =
	'id, guild_id, name, schema_version, revision::text, configuration, document';

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
	try {
		assertHuntDocument(row.document);
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
		document: row.document,
	};
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
			const { rows } = await connection.query<HuntRow>(
				`SELECT ${huntColumns} FROM hunts WHERE id = $1 AND guild_id = $2`,
				[scope.huntId, scope.guildId]
			);
			if (rows.length === 0) {
				throw new HuntCommandError(
					'not-found',
					'Hunt not found in this guild.'
				);
			}
			return snapshotFromRow(rows[0]);
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
			const { rows } = await connection.query<HuntRow>(
				`SELECT ${huntColumns} FROM hunts
				 WHERE id = $1 AND guild_id = $2 FOR UPDATE`,
				[scope.huntId, scope.guildId]
			);
			if (rows.length === 0) {
				throw new HuntCommandError(
					'not-found',
					'Hunt not found in this guild.'
				);
			}
			const snapshot = snapshotFromRow(rows[0]);
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
			if (command.type === 'add') {
				for (const node of command.nodes) {
					const { rows: reserved } = await connection.query<{
						node_id: string;
					}>(
						`INSERT INTO node_identities (hunt_id, node_id) VALUES ($1, $2)
						 ON CONFLICT DO NOTHING RETURNING node_id`,
						[scope.huntId, node.id]
					);
					if (reserved.length === 0) {
						throw new HuntCommandError(
							'conflict',
							`Node ID ${node.id} was already used.`
						);
					}
				}
			}
			const committed: HuntSnapshot = {
				...snapshot,
				revision: snapshot.revision + 1,
				document: applied.document,
			};
			await connection.query(
				`UPDATE hunts SET document = $3::jsonb, revision = $4, updated_at = clock_timestamp()
				 WHERE id = $1 AND guild_id = $2`,
				[
					scope.huntId,
					scope.guildId,
					JSON.stringify(committed.document),
					committed.revision,
				]
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

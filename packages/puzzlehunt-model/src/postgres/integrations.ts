import { HuntCommandError } from '../document.js';
import type {
	HuntCommand,
	HuntDocumentEvent,
	HuntIntegrationCommand,
	HuntScope,
	HuntSnapshot,
} from '../document.js';
import type { HuntDatabaseConnection } from './database.js';

export type HuntIntegrationTarget = 'discord' | 'google';

/** Validate work under the command transaction's hunt lock before applying its result. */
export async function validateIntegrationWork(
	connection: HuntDatabaseConnection,
	scope: HuntScope,
	workId: string,
	result: HuntCommand | HuntIntegrationCommand | undefined
): Promise<void> {
	const { rows } = await connection.query<{
		node_id: string;
		target: HuntIntegrationTarget;
		completed_at: unknown;
		cancelled_at: unknown;
	}>(
		`SELECT node_id, target, completed_at, cancelled_at
		 FROM integration_jobs WHERE hunt_id = $1 AND id = $2`,
		[scope.huntId, workId]
	);
	if (rows.length === 0) {
		throw new HuntCommandError(
			'not-found',
			'Integration work not found in this hunt.'
		);
	}
	const work = rows[0];
	if (work.completed_at !== null || work.cancelled_at !== null) {
		throw new HuntCommandError(
			'conflict',
			'Integration work is no longer pending.'
		);
	}
	if (
		result !== undefined &&
		(result.type !== 'set-property' ||
			result.nodeId !== work.node_id ||
			result.property !==
				(work.target === 'discord' ? 'discord' : 'sheetId'))
	) {
		throw new HuntCommandError(
			'invalid-command',
			'Integration result does not match the work item.'
		);
	}
}

/** Complete only this item, using the same transaction that persists its association. */
export async function completeIntegrationWork(
	connection: HuntDatabaseConnection,
	scope: HuntScope,
	workId: string
): Promise<void> {
	const { rows } = await connection.query<{ id: string }>(
		`UPDATE integration_jobs SET completed_at = clock_timestamp()
		 WHERE hunt_id = $1 AND id = $2
		 AND completed_at IS NULL AND cancelled_at IS NULL
		 RETURNING id`,
		[scope.huntId, workId]
	);
	if (rows.length !== 1) {
		throw new HuntCommandError(
			'conflict',
			'Integration work is no longer pending.'
		);
	}
}

/** Record pending work on the document command's already-open transaction. */
export async function recordPendingIntegrationWork(
	connection: HuntDatabaseConnection,
	commandId: string,
	committed: HuntSnapshot,
	events: readonly HuntDocumentEvent[],
	changedIds: readonly string[]
): Promise<void> {
	const removed = changedIds.filter(
		(id) => committed.document.nodes[id] === undefined
	);
	if (removed.length > 0) {
		await connection.query(
			`UPDATE integration_jobs SET cancelled_at = clock_timestamp()
			 WHERE hunt_id = $1 AND node_id = ANY($2::uuid[])
			 AND completed_at IS NULL AND cancelled_at IS NULL`,
			[committed.huntId, removed]
		);
	}
	const nodes = changedIds.flatMap((id) => {
		const node = committed.document.nodes[id];
		return node === undefined ? [] : [node];
	});
	const configuration = JSON.stringify(committed.document.configuration);
	if (nodes.length > 0) {
		await connection.query(
			`INSERT INTO integration_jobs
			 (hunt_id, command_id, node_id, target, kind, source_revision, payload)
			 SELECT $1, $2, (node->>'id')::uuid, target, kind, $3,
				jsonb_build_object('node', node, 'configuration', $5::jsonb)
			 FROM jsonb_array_elements($4::jsonb) AS changed(node)
			 CROSS JOIN (VALUES
				('discord', 'ensure-discord-association'),
				('google', 'ensure-google-sheet')
			 ) AS work(target, kind)
			 WHERE target = 'discord' OR node->>'type' = 'puzzle'`,
			[
				committed.huntId,
				commandId,
				committed.revision,
				JSON.stringify(nodes),
				configuration,
			]
		);
	}
	if (events.length > 0) {
		await connection.query(
			`INSERT INTO integration_events (hunt_id, command_id, ordinal, revision, payload)
			 SELECT $1, $2, (ordinal - 1)::integer, $3,
				jsonb_build_object('event', event, 'configuration', $5::jsonb)
			 FROM jsonb_array_elements($4::jsonb) WITH ORDINALITY AS emitted(event, ordinal)`,
			[
				committed.huntId,
				commandId,
				committed.revision,
				JSON.stringify(events),
				configuration,
			]
		);
	}
}

import {
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
	HuntScope,
	HuntSnapshot,
	NewDocumentNode,
} from '../document.js';

/** Invalid responses are uncertain outcomes, never authoritative command rejections. */
export class HuntProtocolError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'HuntProtocolError';
	}
}

function requireValue(condition: boolean, message: string): asserts condition {
	if (!condition) {
		throw new HuntProtocolError(message);
	}
}

function object(value: unknown): Record<string, unknown> {
	requireValue(
		typeof value === 'object' && value !== null && !Array.isArray(value),
		'Expected a JSON object.'
	);
	return value as Record<string, unknown>;
}

function keys(
	value: Record<string, unknown>,
	allowed: readonly string[]
): void {
	requireValue(
		Object.keys(value).every((key) => allowed.includes(key)),
		'Unexpected JSON property.'
	);
}

function string(value: unknown): string {
	requireValue(typeof value === 'string', 'Expected a string.');
	return value;
}

function id(value: unknown): string {
	const result = string(value);
	requireValue(isDocumentId(result), 'Expected a lowercase UUID.');
	return result;
}

function parent(value: unknown): string | null {
	return value === null ? null : id(value);
}

function integer(value: unknown): number {
	requireValue(
		typeof value === 'number' && Number.isSafeInteger(value) && value >= 0,
		'Expected a nonnegative safe integer.'
	);
	return value;
}

function newNode(value: unknown): NewDocumentNode {
	const node = object(value);
	keys(node, ['id', 'type', 'name', 'url', 'parentId']);
	const common = {
		id: id(node.id),
		name: string(node.name),
		url: string(node.url),
	};
	if (node.type === 'round') {
		return { ...common, type: 'round', parentId: parent(node.parentId) };
	}
	requireValue(node.type === 'puzzle', 'Expected a round or puzzle.');
	return { ...common, type: 'puzzle', parentId: id(node.parentId) };
}

function command(value: unknown): HuntCommand {
	const input = object(value);
	if (input.type === 'add') {
		keys(input, ['type', 'nodes']);
		requireValue(Array.isArray(input.nodes), 'Expected a node array.');
		return { type: 'add', nodes: input.nodes.map(newNode) };
	}
	const nodeId = id(input.nodeId);
	switch (input.type) {
		case 'delete':
		case 'unsolve':
			keys(input, ['type', 'nodeId']);
			return { type: input.type, nodeId };
		case 'rename':
			keys(input, ['type', 'nodeId', 'name']);
			return { type: 'rename', nodeId, name: string(input.name) };
		case 'set-url':
			keys(input, ['type', 'nodeId', 'url']);
			return { type: 'set-url', nodeId, url: string(input.url) };
		case 'move':
			keys(input, ['type', 'nodeId', 'parentId']);
			return { type: 'move', nodeId, parentId: parent(input.parentId) };
		case 'solve':
			keys(input, ['type', 'nodeId', 'answer']);
			return { type: 'solve', nodeId, answer: string(input.answer) };
		case 'set-status':
			keys(input, ['type', 'nodeId', 'status']);
			return {
				type: 'set-status',
				nodeId,
				status: input.status === null ? null : string(input.status),
			};
		case 'set-sheet':
			keys(input, ['type', 'nodeId', 'sheetId']);
			return {
				type: 'set-sheet',
				nodeId,
				sheetId: input.sheetId === null ? null : string(input.sheetId),
			};
		default:
			throw new HuntProtocolError('Unknown public hunt command.');
	}
}

/** Public writes cannot include ownership, replacement state, or worker commands. */
export function decodeHuntCommandRequest(value: unknown): HuntCommandRequest {
	try {
		const request = object(value);
		keys(request, ['commandId', 'command']);
		return {
			commandId: id(request.commandId),
			command: command(request.command),
		};
	} catch (error) {
		if (error instanceof HuntProtocolError) {
			throw new HuntCommandError('invalid-command', error.message);
		}
		throw error;
	}
}

function configuration(value: unknown): HuntConfiguration {
	const input = object(value);
	const logging = input.loggingChannelIds;
	let loggingChannelIds: HuntConfiguration['loggingChannelIds'];
	if (logging !== undefined) {
		const channels = object(logging);
		loggingChannelIds = {
			puzzleAdd: string(channels.puzzleAdd),
			puzzleSolve: string(channels.puzzleSolve),
			puzzleStatusUpdate: string(channels.puzzleStatusUpdate),
		};
	}
	return {
		...(input.googleFolderId === undefined
			? {}
			: { googleFolderId: string(input.googleFolderId) }),
		...(input.indexId === undefined
			? {}
			: { indexId: string(input.indexId) }),
		...(input.allPuzzlesRoleId === undefined
			? {}
			: { allPuzzlesRoleId: string(input.allPuzzlesRoleId) }),
		...(loggingChannelIds === undefined ? {} : { loggingChannelIds }),
	};
}

function discord(value: unknown): DocumentDiscordAssociation {
	const input = object(value);
	return {
		channelId: string(input.channelId),
		roleId: string(input.roleId),
		...(input.indexChannelId === undefined
			? {}
			: { indexChannelId: string(input.indexChannelId) }),
	};
}

function node(value: unknown): DocumentNode {
	const input = object(value);
	const common = {
		id: id(input.id),
		name: string(input.name),
		url: string(input.url),
		position: integer(input.position),
		...(input.discord === undefined
			? {}
			: { discord: discord(input.discord) }),
	};
	if (input.type === 'round') {
		requireValue(
			['answer', 'status', 'lastStatusUpdate', 'sheetId'].every(
				(key) => input[key] === undefined
			),
			'Rounds cannot have puzzle properties.'
		);
		return { ...common, type: 'round', parentId: parent(input.parentId) };
	}
	requireValue(input.type === 'puzzle', 'Expected a round or puzzle.');
	return {
		...common,
		type: 'puzzle',
		parentId: id(input.parentId),
		...(input.answer === undefined ? {} : { answer: string(input.answer) }),
		...(input.status === undefined ? {} : { status: string(input.status) }),
		...(input.lastStatusUpdate === undefined
			? {}
			: { lastStatusUpdate: integer(input.lastStatusUpdate) }),
		...(input.sheetId === undefined
			? {}
			: { sheetId: string(input.sheetId) }),
	};
}

export function decodeHuntSnapshot(
	value: unknown,
	scope?: HuntScope
): HuntSnapshot {
	const input = object(value);
	const huntId = id(input.huntId);
	const guildId = string(input.guildId);
	requireValue(guildId.length > 0, 'Expected a guild ID.');
	requireValue(input.schemaVersion === 1, 'Unsupported hunt schema version.');
	requireValue(
		scope === undefined ||
			(scope.huntId === huntId && scope.guildId === guildId),
		'Response returned a different hunt scope.'
	);
	const source = object(object(input.document).nodes);
	const nodes: Record<string, DocumentNode> = {};
	for (const [key, value] of Object.entries(source)) {
		const decoded = node(value);
		requireValue(key === decoded.id, 'Node key does not match its ID.');
		nodes[key] = decoded;
	}
	try {
		assertHuntDocument({ nodes });
	} catch (error) {
		throw new HuntProtocolError('Invalid hunt document in response.', {
			cause: error,
		});
	}
	return {
		huntId,
		guildId,
		schemaVersion: 1,
		revision: integer(input.revision),
		name: string(input.name),
		configuration: configuration(input.configuration),
		document: { nodes },
	};
}

export function decodeHuntCommandResult(
	value: unknown,
	scope: HuntScope,
	commandId: string
): HuntCommandResult {
	const input = object(value);
	const receipt = object(input.receipt);
	const snapshot = decodeHuntSnapshot(input.snapshot, scope);
	const committedRevision = integer(receipt.committedRevision);
	requireValue(
		receipt.commandId === commandId &&
			committedRevision <= snapshot.revision,
		'Invalid command receipt.'
	);
	requireValue(
		typeof input.replayed === 'boolean',
		'Expected a replay flag.'
	);
	return {
		receipt: { commandId, committedRevision },
		snapshot,
		replayed: input.replayed,
	};
}

export const huntRejectionStatuses: Readonly<
	Record<HuntCommandError['code'], readonly number[]>
> = {
	'invalid-command': [400, 405, 413, 415],
	'not-found': [404],
	conflict: [409],
	unauthorized: [401],
	forbidden: [403],
};

/** Only explicit, matching API rejections prove that a command was not applied. */
export function decodeHuntRejection(
	value: unknown,
	status: number
): HuntCommandError | undefined {
	if (typeof value !== 'object' || value === null || !('error' in value)) {
		return undefined;
	}
	const error = value.error;
	if (
		typeof error !== 'object' ||
		error === null ||
		!('code' in error) ||
		!('message' in error)
	) {
		return undefined;
	}
	for (const [code, statuses] of Object.entries(huntRejectionStatuses)) {
		if (
			error.code === code &&
			statuses.includes(status) &&
			typeof error.message === 'string'
		) {
			return new HuntCommandError(
				code as HuntCommandError['code'],
				error.message
			);
		}
	}
	return undefined;
}

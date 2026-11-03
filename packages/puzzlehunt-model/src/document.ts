/** Document types and domain commands, without Fluid or platform dependencies. */
export interface HuntScope {
	readonly huntId: string;
	readonly guildId: string;
}

export interface HuntConfiguration {
	readonly googleFolderId?: string;
	readonly indexId?: string;
	readonly allPuzzlesRoleId?: string;
	readonly loggingChannelIds?: {
		readonly puzzleAdd: string;
		readonly puzzleSolve: string;
		readonly puzzleStatusUpdate: string;
	};
}

export interface DocumentDiscordAssociation {
	readonly channelId: string;
	readonly roleId: string;
	readonly indexChannelId?: string;
}

interface DocumentNodeBase {
	readonly id: string;
	readonly name: string;
	readonly url: string;
	readonly parentId: string | null;
	readonly position: number;
	readonly discord?: DocumentDiscordAssociation;
}

export interface DocumentRound extends DocumentNodeBase {
	readonly type: 'round';
}

export interface DocumentPuzzle extends DocumentNodeBase {
	readonly type: 'puzzle';
	readonly parentId: string;
	readonly answer?: string;
	readonly status?: string;
	/** Unix milliseconds; PostgreSQL commits use server time. Present exactly when status is present. */
	readonly lastStatusUpdate?: number;
	readonly sheetId?: string;
}

export type DocumentNode = DocumentRound | DocumentPuzzle;

export interface HuntDocument {
	readonly nodes: Readonly<Record<string, DocumentNode>>;
}

export interface HuntSnapshot extends HuntScope {
	readonly schemaVersion: 1;
	readonly revision: number;
	readonly name: string;
	readonly configuration: HuntConfiguration;
	readonly document: HuntDocument;
}

export type NewDocumentNode =
	| {
			readonly id: string;
			readonly type: 'round';
			readonly name: string;
			readonly url: string;
			readonly parentId: string | null;
	  }
	| {
			readonly id: string;
			readonly type: 'puzzle';
			readonly name: string;
			readonly url: string;
			readonly parentId: string;
	  };

/** User intent, not replacement state or a client-computed tree diff. */
export type HuntCommand =
	| { readonly type: 'add'; readonly nodes: readonly NewDocumentNode[] }
	| { readonly type: 'delete'; readonly nodeId: string }
	| {
			readonly type: 'rename';
			readonly nodeId: string;
			readonly name: string;
	  }
	| {
			readonly type: 'set-url';
			readonly nodeId: string;
			readonly url: string;
	  }
	| {
			readonly type: 'move';
			readonly nodeId: string;
			readonly parentId: string | null;
	  }
	| {
			readonly type: 'solve';
			readonly nodeId: string;
			readonly answer: string;
	  }
	| { readonly type: 'unsolve'; readonly nodeId: string }
	| {
			readonly type: 'set-status';
			readonly nodeId: string;
			readonly status: string | null;
	  }
	| {
			readonly type: 'set-sheet';
			readonly nodeId: string;
			readonly sheetId: string | null;
	  };

/** Only integration workers may submit these; never expose as general user writes. */
export type HuntIntegrationCommand = {
	readonly type: 'set-discord';
	readonly nodeId: string;
	readonly discord: DocumentDiscordAssociation | null;
};

export interface HuntCommandRequest {
	/** A UUID retained across retries of this exact command. */
	readonly commandId: string;
	readonly command: HuntCommand;
}

export interface HuntCommandResult {
	readonly receipt: {
		readonly commandId: string;
		readonly committedRevision: number;
	};
	/** Current state, possibly newer than the receipt on a deduplicated retry. */
	readonly snapshot: HuntSnapshot;
	readonly replayed: boolean;
}

/** A transport boundary, not a mutable model handle. Calls reject on failure. */
export interface HuntDocumentClient {
	read(scope: HuntScope): Promise<HuntSnapshot>;
	submit(
		scope: HuntScope,
		request: HuntCommandRequest
	): Promise<HuntCommandResult>;
}

/** Persist each event separately; unlike desired-state refreshes these do not coalesce. */
export type HuntDocumentEvent =
	| { readonly type: 'node-added'; readonly node: DocumentNode }
	| { readonly type: 'node-deleted'; readonly node: DocumentNode }
	| { readonly type: 'puzzle-solved'; readonly node: DocumentPuzzle }
	| { readonly type: 'puzzle-status-updated'; readonly node: DocumentPuzzle };

export class HuntCommandError extends Error {
	constructor(
		public readonly code: 'invalid-command' | 'not-found' | 'conflict',
		message: string
	) {
		super(message);
		this.name = 'HuntCommandError';
	}
}

function requireCommand(
	condition: boolean,
	message: string
): asserts condition {
	if (!condition) {
		throw new HuntCommandError('invalid-command', message);
	}
}

export function isDocumentId(value: string): boolean {
	return (
		typeof value === 'string' &&
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
			value
		)
	);
}

function getNode(document: HuntDocument, id: string): DocumentNode {
	requireCommand(isDocumentId(id), 'Node IDs must be lowercase UUIDs.');
	const node = document.nodes[id];
	if (node === undefined) {
		throw new HuntCommandError('not-found', `Node ${id} does not exist.`);
	}
	return node;
}

function getPuzzle(document: HuntDocument, id: string): DocumentPuzzle {
	const node = getNode(document, id);
	requireCommand(node.type === 'puzzle', 'This command requires a puzzle.');
	return node;
}

function requireParent(document: HuntDocument, parentId: string | null): void {
	if (parentId !== null) {
		requireCommand(
			getNode(document, parentId).type === 'round',
			'The parent must be a round.'
		);
	}
}

/** Children are a projection, never a second persisted authority. */
export function documentChildren(
	document: HuntDocument,
	parentId: string | null
): readonly DocumentNode[] {
	return Object.values(document.nodes)
		.filter((node) => node.parentId === parentId)
		.sort(
			(a, b) =>
				a.position - b.position ||
				(a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
		);
}

export interface HuntDocumentView {
	readonly snapshot: HuntSnapshot;
	readonly rootRounds: readonly DocumentRound[];
	readonly rounds: readonly DocumentRound[];
	readonly puzzles: readonly DocumentPuzzle[];
	readonly childrenByRound: Readonly<Record<string, readonly DocumentNode[]>>;
}

/** A synchronous projection of one committed snapshot, suitable for React/Discord views. */
export function projectHuntDocument(snapshot: HuntSnapshot): HuntDocumentView {
	const nodes = Object.values(snapshot.document.nodes);
	const rounds = nodes.filter(
		(node): node is DocumentRound => node.type === 'round'
	);
	const childrenByRound: Record<string, readonly DocumentNode[]> = {};
	for (const round of rounds) {
		childrenByRound[round.id] = documentChildren(
			snapshot.document,
			round.id
		);
	}
	return {
		snapshot,
		rootRounds: rounds
			.filter((round) => round.parentId === null)
			.sort((a, b) => a.position - b.position),
		rounds,
		puzzles: nodes.filter(
			(node): node is DocumentPuzzle => node.type === 'puzzle'
		),
		childrenByRound,
	};
}

/** Checks graph invariants for trusted, typed snapshots (not an HTTP JSON decoder). */
export function assertHuntDocument(document: HuntDocument): void {
	const siblingPositions = new Map<string | null, Set<number>>();
	for (const [id, node] of Object.entries(document.nodes)) {
		requireCommand(
			isDocumentId(id) && id === node.id,
			'Invalid node identity.'
		);
		requireCommand(
			node.type === 'round' || node.type === 'puzzle',
			'Invalid node type.'
		);
		requireCommand(
			typeof node.name === 'string' && typeof node.url === 'string',
			'Node name and URL must be strings.'
		);
		requireCommand(
			Number.isSafeInteger(node.position) && node.position >= 0,
			'Invalid sibling position.'
		);
		requireCommand(
			node.type !== 'puzzle' || node.parentId !== null,
			'Puzzles must have a parent round.'
		);
		requireParent(document, node.parentId);
		const positions =
			siblingPositions.get(node.parentId) ?? new Set<number>();
		requireCommand(
			!positions.has(node.position),
			'Sibling positions must be unique.'
		);
		positions.add(node.position);
		siblingPositions.set(node.parentId, positions);
		const ancestors = new Set([id]);
		let parentId = node.parentId;
		while (parentId !== null) {
			requireCommand(
				!ancestors.has(parentId),
				'The tree cannot contain cycles.'
			);
			ancestors.add(parentId);
			parentId = getNode(document, parentId).parentId;
		}
		if (node.type === 'puzzle') {
			requireCommand(
				(node.answer === undefined ||
					typeof node.answer === 'string') &&
					(node.sheetId === undefined ||
						typeof node.sheetId === 'string'),
				'Answer and sheet ID must be strings when present.'
			);
			requireCommand(
				node.status === undefined
					? node.lastStatusUpdate === undefined
					: typeof node.status === 'string' &&
							typeof node.lastStatusUpdate === 'number' &&
							Number.isSafeInteger(node.lastStatusUpdate) &&
							node.lastStatusUpdate >= 0,
				'Status and its server timestamp must be present together.'
			);
		}
		if (node.discord !== undefined) {
			requireCommand(
				typeof node.discord.channelId === 'string' &&
					typeof node.discord.roleId === 'string' &&
					(node.type === 'round'
						? typeof node.discord.indexChannelId === 'string'
						: node.discord.indexChannelId === undefined),
				'Invalid Discord association.'
			);
		}
	}
}

/**
 * On the server, apply once to fresh state while holding the hunt row lock. Receipt deduplication
 * belongs to that same transaction and must happen before calling this function.
 * Optimistic projections reuse this reducer with provisional time; only committed
 * server events may enqueue external integration work.
 */
export function applyHuntCommand(
	document: HuntDocument,
	command: HuntCommand | HuntIntegrationCommand,
	serverTime: number
): { document: HuntDocument; events: readonly HuntDocumentEvent[] } {
	requireCommand(
		Number.isSafeInteger(serverTime) && serverTime >= 0,
		'Invalid server timestamp.'
	);
	assertHuntDocument(document);
	const nodes: Record<string, DocumentNode> = { ...document.nodes };
	const next = { nodes };
	const events: HuntDocumentEvent[] = [];
	const appendPosition = (parentId: string | null): number =>
		Math.max(
			-1,
			...documentChildren(next, parentId).map((node) => node.position)
		) + 1;

	switch (command.type) {
		case 'add': {
			requireCommand(
				command.nodes.length > 0,
				'Add requires at least one node.'
			);
			for (const input of command.nodes) {
				requireCommand(
					isDocumentId(input.id),
					'Node IDs must be lowercase UUIDs.'
				);
				if (nodes[input.id] !== undefined) {
					throw new HuntCommandError(
						'conflict',
						`Node ${input.id} already exists.`
					);
				}
				requireParent(next, input.parentId);
				const common = {
					id: input.id,
					name: input.name,
					url: input.url,
					position: appendPosition(input.parentId),
				};
				const node: DocumentNode =
					input.type === 'round'
						? { ...common, type: 'round', parentId: input.parentId }
						: {
								...common,
								type: 'puzzle',
								parentId: input.parentId,
						  };
				nodes[node.id] = node;
				events.push({ type: 'node-added', node });
			}
			break;
		}
		case 'delete': {
			const pending = [getNode(next, command.nodeId)];
			while (pending.length > 0) {
				const node = pending.pop()!;
				pending.push(...documentChildren(next, node.id));
				events.push({ type: 'node-deleted', node });
				delete nodes[node.id];
			}
			break;
		}
		case 'rename': {
			const node = getNode(next, command.nodeId);
			nodes[node.id] = { ...node, name: command.name };
			break;
		}
		case 'set-url': {
			const node = getNode(next, command.nodeId);
			nodes[node.id] = { ...node, url: command.url };
			break;
		}
		case 'move': {
			const node = getNode(next, command.nodeId);
			requireParent(next, command.parentId);
			if (node.parentId !== command.parentId) {
				const position = appendPosition(command.parentId);
				if (node.type === 'puzzle') {
					requireCommand(
						command.parentId !== null,
						'Puzzles must have a parent round.'
					);
					nodes[node.id] = {
						...node,
						parentId: command.parentId,
						position,
					};
				} else {
					nodes[node.id] = {
						...node,
						parentId: command.parentId,
						position,
					};
				}
			}
			break;
		}
		case 'solve': {
			const node = getPuzzle(next, command.nodeId);
			requireCommand(
				typeof command.answer === 'string' && command.answer.length > 0,
				'Solve requires an answer.'
			);
			const { status, lastStatusUpdate, ...rest } = node;
			const solved = { ...rest, answer: command.answer };
			nodes[node.id] = solved;
			events.push({ type: 'puzzle-solved', node: solved });
			break;
		}
		case 'unsolve': {
			const node = getPuzzle(next, command.nodeId);
			const { answer, ...rest } = node;
			nodes[node.id] = rest;
			break;
		}
		case 'set-status': {
			const node = getPuzzle(next, command.nodeId);
			const { status, lastStatusUpdate, ...rest } = node;
			requireCommand(
				command.status === null || typeof command.status === 'string',
				'Status must be a string or null.'
			);
			const updated =
				command.status === null
					? rest
					: {
							...rest,
							status: command.status,
							lastStatusUpdate: serverTime,
					  };
			nodes[node.id] = updated;
			events.push({ type: 'puzzle-status-updated', node: updated });
			break;
		}
		case 'set-sheet': {
			const node = getPuzzle(next, command.nodeId);
			requireCommand(
				command.sheetId === null || typeof command.sheetId === 'string',
				'Sheet ID must be a string or null.'
			);
			const { sheetId, ...rest } = node;
			nodes[node.id] =
				command.sheetId === null
					? rest
					: { ...rest, sheetId: command.sheetId };
			break;
		}
		case 'set-discord': {
			const node = getNode(next, command.nodeId);
			const { discord, ...rest } = node;
			nodes[node.id] =
				command.discord === null
					? rest
					: { ...rest, discord: { ...command.discord } };
			break;
		}
		default: {
			const exhaustive: never = command;
			throw new HuntCommandError(
				'invalid-command',
				`Unknown command: ${exhaustive}`
			);
		}
	}
	assertHuntDocument(next);
	return { document: next, events };
}

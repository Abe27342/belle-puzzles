/**
 * REGION
 *
 * Document representation of a puzzlehunt as a forest of rounds and puzzles.
 * This is a forest and not a tree as multiple root rounds are allowed.
 * All puzzles are leafs, and must have an associated parent round.
 * Rounds may be nested within other rounds in the tree structure.
 *
 * The document representation includes metadata associated with Discord and Google Drive.
 */

/**
 * Top-level identifiers for an individual puzzlehunt.
 */
export interface HuntScope {
	/**
	 * Hunt identifier (uuid)
	 */
	readonly huntId: string;
	/**
	 * ID of the guild this hunt belongs to.
	 */
	readonly guildId: Snowflake;
}

/**
 * Branded type for Discord's {@link https://docs.discord.com/developers/reference#snowflakes | snowflake} identifier.
 */
export type Snowflake = string & { brand: 'discordSnowflake' };

export function snowflake(s: string): Snowflake {
	// TODO: We could consider validating the format here.
	return s as Snowflake;
}

/**
 * Top-level configuration for a puzzlehunt. This data generally only needs to be configured at hunt creation time.
 */
export interface HuntConfiguration {
	/**
	 * Google Drive folder ID for where puzzle spreadsheets are stored.
	 */
	readonly googleFolderId?: string;
	/**
	 * ID of the top-level "Puzzle Index" category channel for the hunt
	 */
	readonly indexId?: Snowflake;
	/**
	 * ID of the role that grants access to all puzzles.
	 */
	readonly allPuzzlesRoleId?: Snowflake;
	/**
	 * IDs for channels that receive logging messages on various puzzle-related events.
	 */
	readonly loggingChannelIds?: {
		readonly puzzleAdd: Snowflake;
		readonly puzzleSolve: Snowflake;
		readonly puzzleStatusUpdate: Snowflake;
	};
}

/**
 * Discord associations for a document node, including channel and role IDs.
 */
export interface DocumentDiscordAssociation {
	/**
	 * ID of the Discord channel associated with this document node.
	 *
	 * For rounds, this is the category channel for the round.
	 */
	readonly channelId: Snowflake;

	/**
	 * ID of the Discord role that makes this document node visible.
	 */
	readonly roleId: Snowflake;

	/**
	 * For rounds, ID of the index channel associated with the round. Undefined for puzzles.
	 */
	readonly indexChannelId?: Snowflake;
}

/**
 * Common properties for document nodes, i.e. puzzles and rounds.
 */
interface DocumentNodeBase {
	/**
	 * Unique identifier for this document node (uuid).
	 */
	readonly id: string;
	/**
	 * Human-readable name for this document node.
	 */
	readonly name: string;
	/**
	 * URL associated with this document node.
	 *
	 * @remarks
	 * The discord integration uses this URL to link the puzzle page from its associated discord channel.
	 */
	readonly url: string;
	/**
	 * ID of the parent document node, or null if this is a top-level round.
	 */
	readonly parentId: string | null;

	/**
	 * Position of this document node relative to its siblings.
	 */
	readonly position: number;

	/**
	 * Discord associations for this document node, if any.
	 *
	 * @remarks
	 * Discord has relatively aggressive rate limiting on channel operations.
	 * Tolerating addition of objects before their associate discord channels exist allows linking
	 * puzzle pages from the web view before the corresponding Discord channels are created.
	 */
	readonly discord?: DocumentDiscordAssociation;
}

/**
 * Document representation of a round.
 */
export interface DocumentRound extends DocumentNodeBase {
	readonly type: 'round';
}

/**
 * Document representation of a puzzle.
 */
export interface DocumentPuzzle extends DocumentNodeBase {
	readonly type: 'puzzle';
	readonly parentId: string;
	/**
	 * Answer to the puzzle, if available.
	 */
	readonly answer?: string;
	/**
	 * Status of the puzzle, if available.
	 *
	 * The associated user flow with this field is that users can explicitly update the status message of a puzzle,
	 * e.g. via a discord command on the associated puzzle channel.
	 * Status messages are posted to the top-level hunt logging channel on Discord.
	 * These can be convenient in larger-scale hunts to e.g. ask for help from other team members.
	 */
	readonly status?: string;
	/**
	 * Timestamp of the last status update in unix milliseconds.
	 *
	 * Present exactly when status is present.
	 */
	readonly lastStatusUpdate?: number;
	/**
	 * Google Sheet ID associated with this puzzle, if available.
	 */
	readonly sheetId?: string;
}

/**
 * A document node, which can be either a round or a puzzle.
 */
export type DocumentNode = DocumentRound | DocumentPuzzle;

export interface HuntDocument {
	readonly name: string;
	readonly configuration: HuntConfiguration;
	/**
	 * Document nodes contained in this hunt document, keyed by their unique IDs.
	 */
	readonly nodes: Readonly<Record<string, DocumentNode>>;
}

export interface HuntSnapshot extends HuntScope {
	readonly schemaVersion: 1;
	readonly revision: number;
	readonly document: HuntDocument;
}

// REGION - Representation of operations that can be performed on a document.

/**
 * Compact representation of changes to a {@link HuntDocument}.
 *
 * This interface is used for SSE (Server-Sent Events) to communicate incremental updates to connected clients.
 */
export interface HuntDelta
	extends Omit<HuntSnapshot, 'document'>,
		Pick<HuntDocument, 'name' | 'configuration'> {
	/**
	 * Revision of the base snapshot that this delta is applied to.
	 */
	readonly baseRevision: number;
	/**
	 * Document nodes that should be added or updated in this delta.
	 *
	 * @remarks
	 * Underlying database queries do not actually use postgres upsert.
	 * However, this event is a reasonable description of the change that needs to occur to the document,
	 * hence reuse of familiar terminology.
	 */
	readonly upsertNodes: readonly DocumentNode[];
	/**
	 * IDs of document nodes that have been deleted in this delta.
	 */
	readonly deletedNodeIds: readonly string[];
}

/**
 * An update to the hunt state, either represented as a {@link HuntDelta} from some base revision or as a full {@link HuntSnapshot}.
 */
export type HuntStateUpdate =
	| { readonly type: 'snapshot'; readonly snapshot: HuntSnapshot }
	| { readonly type: 'delta'; readonly delta: HuntDelta };

export interface HuntCommandUpdateResult {
	readonly receipt: HuntCommandResult['receipt'];
	readonly update: HuntStateUpdate;
	readonly replayed: boolean;
}

/**
 * Applies a {@link HuntStateUpdate} to a base {@link HuntSnapshot}.
 * @returns The resulting {@link HuntSnapshot} after applying the update.
 */
export function applyHuntStateUpdate(
	base: HuntSnapshot,
	update: HuntStateUpdate
): HuntSnapshot {
	const state = update.type === 'snapshot' ? update.snapshot : update.delta;
	if (
		state.huntId !== base.huntId ||
		state.guildId !== base.guildId ||
		state.schemaVersion !== base.schemaVersion ||
		!Number.isSafeInteger(state.revision) ||
		state.revision < base.revision
	) {
		throw new Error('Invalid hunt update scope, schema, or revision.');
	}
	if (update.type === 'snapshot') {
		validateHuntDocument(update.snapshot.document);
		return update.snapshot;
	}
	const delta = update.delta;
	if (delta.baseRevision !== base.revision) {
		throw new Error('Hunt delta does not match the committed base.');
	}
	const nodes = { ...base.document.nodes };
	const affected = new Set<string>();
	for (const id of delta.deletedNodeIds) {
		if (!isUuid(id) || affected.has(id)) {
			throw new Error('Invalid or repeated hunt deletion.');
		}
		affected.add(id);
		delete nodes[id];
	}
	for (const node of delta.upsertNodes) {
		if (affected.has(node.id)) {
			throw new Error('Hunt delta repeats an affected node.');
		}
		affected.add(node.id);
		nodes[node.id] = node;
	}
	const snapshot: HuntSnapshot = {
		huntId: delta.huntId,
		guildId: delta.guildId,
		schemaVersion: delta.schemaVersion,
		revision: delta.revision,
		document: {
			name: delta.name,
			configuration: delta.configuration,
			nodes,
		},
	};
	validateHuntDocument(snapshot.document);
	return snapshot;
}

/**
 * Intent to add new nodes to the puzzlehunt tree.
 */
export type HuntAddCommand = {
	readonly type: 'add';
	readonly nodes: readonly Omit<DocumentNode, 'position'>[];
};
/**
 * Intent to delete a node including all its children in the puzzlehunt tree.
 */
export type HuntDeleteCommand = {
	readonly type: 'delete';
	readonly nodeId: string;
};
/**
 * Intent to move a node to a new parent (or to the root if parentId is null)
 */
export type HuntMoveCommand = {
	readonly type: 'move';
	readonly nodeId: string;
	readonly parentId: string | null;
};

/**
 * Union of all possible user intents for modifying the document.
 */
export type HuntCommand =
	| HuntAddCommand
	| HuntDeleteCommand
	| HuntMoveCommand
	| SetHuntProperty<HuntPropertyValues>;

export interface HuntPropertyValues {
	readonly name: string;
	readonly url: string;
	readonly answer: string | null;
	readonly status: string | null;
	readonly sheetId: string | null;
}

type SetHuntProperty<Properties> = {
	[Property in keyof Properties]: {
		readonly type: 'set-property';
		readonly nodeId: string;
		readonly property: Property;
		readonly value: Properties[Property];
	};
}[keyof Properties];

/** Only integration workers may submit these; never expose as general user writes. */
export type HuntIntegrationCommand = SetHuntProperty<{
	readonly discord: DocumentDiscordAssociation | null;
}>;

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

/**
 * Represents definitively rejected commands with an associated reason.
 */
export class HuntCommandError extends Error {
	constructor(
		public readonly code:
			| 'invalid-command'
			| 'not-found'
			| 'conflict'
			| 'unauthorized'
			| 'forbidden',
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

/**
 * Checks if a string is a valid lowercase UUID.
 */
export function isUuid(value: string): boolean {
	return (
		typeof value === 'string' &&
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
			value
		)
	);
}

/**
 * Checks if a number is a safe array index (non-negative integer within the safe integer range).
 */
export function isSafeIndex(value: unknown): value is number {
	return (
		typeof value === 'number' &&
		Number.isInteger(value) &&
		value >= 0 &&
		value <= Number.MAX_SAFE_INTEGER
	);
}

/**
 * {@link DocumentHunt} wrapper providing efficient children enumeration and ancestry validation.
 */
class ChildrenIndex {
	readonly #document: HuntDocument;
	readonly #children: Map<
		/* id, null for root rounds */ string | null,
		DocumentNode[]
	>;

	readonly #nextPositions = new Map<string | null, number>();

	constructor(document: HuntDocument) {
		this.#document = document;
		this.#children = indexDocumentChildren(document);

		for (const [parentId, children] of this.#children) {
			const lastPosition = children.at(-1)?.position ?? 0;
			this.#nextPositions.set(parentId, lastPosition + 1);

			validateUniqueValues(
				children.map((child) => child.position),
				'Sibling positions must be unique.'
			);
		}
	}

	get(id: string): DocumentNode {
		requireCommand(isUuid(id), 'Node IDs must be lowercase UUIDs.');
		const entry = this.#document.nodes[id];
		if (!entry) {
			throw new HuntCommandError(
				'not-found',
				`Node ${id} does not exist.`
			);
		}
		return entry;
	}

	// TODO: The mutation here is not well-aligned with how the rest of this class functions. Seems like an easy trap.
	appendPosition(parentId: string | null): number {
		const position = this.#nextPositions.get(parentId) ?? 0;
		this.#nextPositions.set(parentId, position + 1);
		return position;
	}

	public childrenOf(parentId: string | null): DocumentNode[] {
		const idKey = parentId !== null ? parentId : 'root';
		return this.#children.get(idKey) ?? [];
	}

	public parentOf(id: string): DocumentNode | undefined {
		const node = this.get(id);
		const { parentId } = node;
		return parentId === null ? undefined : this.get(parentId);
	}

	public get nodes(): Iterable<DocumentNode> {
		return Object.values(this.#document.nodes);
	}

	validateAncestry(): void {
		const complete = new Set<string>();
		for (const node of this.nodes) {
			const path = new Set<DocumentNode>();
			// Iterate ancestors
			let current: DocumentNode | undefined = node;
			while (current && !complete.has(current.id)) {
				requireCommand(
					!path.has(current),
					'The tree cannot contain cycles.'
				);
				path.add(current);
				current = this.parentOf(current.id);
			}
			for (const visited of path) complete.add(visited.id);
		}
	}

	public *subtree(id: string): Iterable<DocumentNode> {
		const pending = [this.get(id)];
		while (pending.length > 0) {
			const node = pending.pop()!;
			yield node;
			for (const child of this.childrenOf(node.id)) pending.push(child);
		}
	}
}

function getPuzzle(index: ChildrenIndex, id: string): DocumentPuzzle {
	const node = index.get(id);
	requireCommand(node.type === 'puzzle', 'This command requires a puzzle.');
	return node;
}

/**
 * Validates that the given parent ID corresponds to a round node that exists in the document.
 */
function requireParent(index: ChildrenIndex, parentId: string): void {
	requireCommand(
		index.get(parentId).type === 'round',
		'Parent must be a round.'
	);
}

/**
 * @param document The hunt document containing the nodes.
 * @param parentId The ID of the parent round, or null for top-level round nodes.
 * @returns An array of child nodes sorted by position and ID.
 */
export function documentChildren(
	document: HuntDocument,
	parentId: string | null
): readonly DocumentNode[] {
	return Object.values(document.nodes)
		.filter((node) => node.parentId === parentId)
		.sort(compareDocumentNodes);
}

function compareDocumentNodes(a: DocumentNode, b: DocumentNode): number {
	return a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Build once per projection rather than scanning the document for each round. */
export function indexDocumentChildren(
	document: Pick<HuntDocument, 'nodes'>
): Map<string | null, DocumentNode[]> {
	const children = new Map<string | null, DocumentNode[]>();
	for (const node of Object.values(document.nodes)) {
		const siblings = getOrCreate(
			children,
			node.parentId,
			(): DocumentNode[] => []
		);
		siblings.push(node);

		if (node.parentId !== null) {
			const parentNode = document.nodes[node.parentId ?? ''];
			requireCommand(
				parentNode !== undefined,
				'Parent node does not exist.'
			);
			requireCommand(
				parentNode.type === 'round',
				'Parent must be a round.'
			);
		}
	}
	for (const siblings of children.values()) {
		siblings.sort(compareDocumentNodes);
	}
	return children;
}

export interface HuntDocumentView {
	readonly snapshot: HuntSnapshot;
	readonly rootRounds: readonly DocumentRound[];
	readonly rounds: readonly DocumentRound[];
	readonly puzzles: readonly DocumentPuzzle[];
	readonly childrenIndex: ChildrenIndex;
}

export function isPuzzle(node: DocumentNode): node is DocumentPuzzle {
	return node.type === 'puzzle';
}

export function isRound(node: DocumentNode): node is DocumentRound {
	return node.type === 'round';
}

/** A synchronous projection of one committed snapshot, suitable for React/Discord views. */
export function projectHuntDocument(snapshot: HuntSnapshot): HuntDocumentView {
	const nodes = Object.values(snapshot.document.nodes);
	const rounds = nodes.filter(isRound);
	const childrenIndex = new ChildrenIndex(snapshot.document);
	return {
		snapshot,
		rootRounds: rounds.filter((node) => node.parentId === null),
		rounds,
		puzzles: nodes.filter(isPuzzle),
		childrenIndex,
	};
}

/** Get or create a value in a map for the given key. */
function getOrCreate<K, V>(map: Map<K, V>, key: K, create: () => V): V {
	let value = map.get(key);
	if (!value) {
		value = create();
		map.set(key, value);
	}
	return value;
}

/**
 * Validate that a hunt document satisfies all structural invariants, including (but not limited to):
 *
 * - All nodes have valid IDs and required property types (e.g. name as string, position as non-negative integer).
 * - Sibling positions are unique and non-negative integers.
 * - Puzzles have a parent round.
 * - The document contains no cycles.
 * - Answers and sheet IDs are strings when present.
 * - Status and its server timestamp are present together and valid.
 *
 * @param document The document to validate
 */
export function validateHuntDocument(document: HuntDocument): void {
	validateDocumentForest(new ChildrenIndex(document));
}

function validateUniqueValues<T>(values: T[], message: string): void {
	const seen = new Set<T>();
	for (const value of values) {
		requireCommand(!seen.has(value), message);
		seen.add(value);
	}
}

function validateDocumentForest(childrenIndex: ChildrenIndex): void {
	for (const node of childrenIndex.nodes) {
		if (isPuzzle(node)) {
			const { answer, sheetId, status, lastStatusUpdate } = node;
			requireCommand(
				(answer === undefined || typeof answer === 'string') &&
					(sheetId === undefined || typeof sheetId === 'string'),
				'Answer and sheet ID must be strings when present.'
			);
			requireCommand(
				status === undefined
					? lastStatusUpdate === undefined
					: typeof status === 'string' &&
							typeof lastStatusUpdate === 'number' &&
							Number.isSafeInteger(lastStatusUpdate) &&
							lastStatusUpdate >= 0,
				'Status and its server timestamp must be present together.'
			);
		} else {
			requireCommand(isRound(node), 'Invalid node type.');
		}

		requireCommand(
			typeof node.name === 'string' && typeof node.url === 'string',
			'Node name and URL must be strings.'
		);
		requireCommand(isSafeIndex(node.position), 'Invalid sibling position.');

		if (node.discord !== undefined) {
			const { channelId, roleId, indexChannelId } = node.discord;
			requireCommand(
				typeof channelId === 'string' &&
					typeof roleId === 'string' &&
					(node.type === 'round'
						? typeof indexChannelId === 'string'
						: indexChannelId === undefined),
				'Invalid Discord association.'
			);
		}
	}
	childrenIndex.validateAncestry();
}

/**
 * Applies a {@link HuntCommand} to the given document, producing a new document state and a list of events.
 *
 * @remarks
 * This is used on both the server (which authoritatively computes the document state) and on clients, whose IPuzzlehunt
 * implementation maintains an optimistic (as in, it is assumed pending local edits will succeed) projection of the document state.
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
	const childrenIndex = new ChildrenIndex(document);
	validateDocumentForest(childrenIndex);
	const nodes: Record<string, DocumentNode> = { ...document.nodes };
	const next = { ...document, nodes };
	const events: HuntDocumentEvent[] = [];

	switch (command.type) {
		case 'add': {
			requireCommand(
				command.nodes.length > 0,
				'Add requires at least one node.'
			);
			for (const input of command.nodes) {
				requireCommand(
					![
						'answer',
						'status',
						'lastStatusUpdate',
						'sheetId',
						'discord',
						'position',
					].some((key) => Object.hasOwnProperty.call(input, key)),
					'Create nodes before assigning puzzle or integration properties.'
				);
				requireCommand(
					isUuid(input.id),
					'Node identity should be a UUID.'
				);
				if (Object.hasOwnProperty.call(nodes, input.id)) {
					throw new HuntCommandError(
						'conflict',
						`Node ${input.id} already exists.`
					);
				}

				const common = {
					id: input.id,
					name: input.name,
					url: input.url,
					position: childrenIndex.appendPosition(input.parentId),
				};
				let node: DocumentNode;
				if (input.type === 'round') {
					node = {
						...common,
						type: 'round',
						parentId: input.parentId,
					};
				} else {
					requireCommand(
						input.parentId !== null,
						'Puzzles must have a parent round.'
					);
					node = {
						...common,
						type: 'puzzle',
						parentId: input.parentId,
					};
				}
				nodes[node.id] = node;
				events.push({ type: 'node-added', node });
			}
			break;
		}
		case 'delete': {
			for (const node of childrenIndex.subtree(command.nodeId)) {
				events.push({ type: 'node-deleted', node });
				delete nodes[node.id];
			}
			break;
		}
		case 'move': {
			const node = childrenIndex.get(command.nodeId);
			if (command.parentId !== null) {
				requireParent(childrenIndex, command.parentId);
			}
			if (node.parentId !== command.parentId) {
				const position = childrenIndex.appendPosition(command.parentId);
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
		case 'set-property': {
			switch (command.property) {
				case 'name':
				case 'url': {
					const node = childrenIndex.get(command.nodeId);
					nodes[node.id] = {
						...node,
						[command.property]: command.value,
					};
					break;
				}
				case 'answer': {
					const node = getPuzzle(childrenIndex, command.nodeId);
					if (command.value === null) {
						const { answer, ...rest } = node;
						nodes[node.id] = rest;
						break;
					}
					requireCommand(
						typeof command.value === 'string' &&
							command.value.length > 0,
						'Solve requires an answer.'
					);
					const { status, lastStatusUpdate, ...rest } = node;
					const solved = { ...rest, answer: command.value };
					nodes[node.id] = solved;
					events.push({ type: 'puzzle-solved', node: solved });
					break;
				}
				case 'status': {
					const node = getPuzzle(childrenIndex, command.nodeId);
					const { status, lastStatusUpdate, ...rest } = node;
					requireCommand(
						command.value === null ||
							typeof command.value === 'string',
						'Status must be a string or null.'
					);
					const updated =
						command.value === null
							? rest
							: {
									...rest,
									status: command.value,
									lastStatusUpdate: serverTime,
							  };
					nodes[node.id] = updated;
					events.push({
						type: 'puzzle-status-updated',
						node: updated,
					});
					break;
				}
				case 'sheetId': {
					const node = getPuzzle(childrenIndex, command.nodeId);
					requireCommand(
						command.value === null ||
							typeof command.value === 'string',
						'Sheet ID must be a string or null.'
					);
					const { sheetId, ...rest } = node;
					nodes[node.id] =
						command.value === null
							? rest
							: { ...rest, sheetId: command.value };
					break;
				}
				case 'discord': {
					const node = childrenIndex.get(command.nodeId);
					const { discord, ...rest } = node;
					nodes[node.id] =
						command.value === null
							? rest
							: { ...rest, discord: { ...command.value } };
					break;
				}
				default: {
					const exhaustive: never = command;
					throw new HuntCommandError(
						'invalid-command',
						`Unknown property command: ${exhaustive}`
					);
				}
			}
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
	validateHuntDocument(next);
	return { document: next, events };
}

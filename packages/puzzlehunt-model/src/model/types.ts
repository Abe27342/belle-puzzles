import { indexDocumentChildren } from '../document.js';
import type {
	DocumentNode,
	DocumentPuzzle,
	DocumentRound,
	HuntDocument,
} from '../document.js';

export interface PuzzlehuntRound extends DocumentRound {
	readonly children: readonly (PuzzlehuntRound | DocumentPuzzle)[];
}

export interface PuzzlehuntView {
	readonly rounds: readonly PuzzlehuntRound[];
	readonly puzzles: readonly DocumentPuzzle[];
}

export interface DiscordPuzzleInfo {
	channel: { /* channel ID */ id: string } | string;
	role: { /* role ID */ id: string } | string;
}

export interface DiscordRoundInfo extends DiscordPuzzleInfo {
	indexChannel: { /* channel ID */ id: string } | string;
}

export interface LoggingChannelIds {
	puzzleAdd: string;
	puzzleSolve: string;
	puzzleStatusUpdate: string;
}

/**
 * Changed nodes contain full old/new values.
 */
export type PuzzlehuntNodeChange =
	| { readonly type: 'node-added'; readonly node: DocumentNode }
	| { readonly type: 'node-removed'; readonly node: DocumentNode }
	| {
			readonly type: 'node-changed';
			readonly before: DocumentNode;
			readonly after: DocumentNode;
	  };

/**
 * Raised when the backing data model changes. May include local optimistic edits.
 * Each affected node appears once; whole added or removed subtrees include every domain node.
 * Views are stable historical read-only values, including derived round children,
 * even after the live model advances.
 */
export interface PuzzlehuntChangeEvent {
	readonly before: PuzzlehuntView;
	readonly after: PuzzlehuntView;
	readonly changes: readonly PuzzlehuntNodeChange[];
}

/**
 * Reads and mutations over backend-independent, read-only node values.
 * Returned nodes are snapshots; retrieve them again to observe subsequent edits.
 * Mutations resolve supplied node IDs against the current model state.
 */
export interface IPuzzlehunt {
	/** Plain stable-ID view, shared by model adapters and event consumers. */
	readonly view: PuzzlehuntView;
	readonly rounds: Iterable<PuzzlehuntRound>;
	readonly puzzles: Iterable<DocumentPuzzle>;
	readonly guildId: string;
	readonly loggingChannelIds: LoggingChannelIds | undefined;
	setLoggingChannelIds(ids: LoggingChannelIds): void;
	/** Observe changes to the puzzlehunt model. Returns an unsubscribe function. */
	subscribeChanges(
		listener: (event: PuzzlehuntChangeEvent) => void
	): () => void;
	getRound(id: string): PuzzlehuntRound;
	getPuzzle(id: string): DocumentPuzzle;
	addRound(
		name: string,
		url: string,
		parent?: PuzzlehuntRound
	): PuzzlehuntRound;
	addRounds(
		rounds: { name: string; url: string }[],
		parent: PuzzlehuntRound
	): void;
	addPuzzle(
		name: string,
		url: string,
		round: PuzzlehuntRound
	): DocumentPuzzle;
	addPuzzles(
		puzzles: { name: string; url: string }[],
		round: PuzzlehuntRound
	): void;
	delete(node: DocumentNode): void;
	changeName(node: DocumentNode, name: string): void;
	changeUrl(node: DocumentNode, url: string): void;
	move(node: DocumentNode, parent: PuzzlehuntRound): void;
	solve(id: string, answer: string): DocumentPuzzle;
	unsolve(id: string): DocumentPuzzle;
	updateStatus(puzzle: DocumentPuzzle, status: string): void;
	clearStatus(puzzle: DocumentPuzzle): void;
	/**
	 * Record a puzzle's Discord association.
	 * @param durableTaskId Identifies persisted provisioning work completed by this write.
	 * Task-backed writes validate the task's node and target and atomically save the
	 * association and task completion. Retrying the same task and result is idempotent;
	 * cancelled, mismatched, or differently completed tasks are rejected.
	 * Task-backed results become visible after durable acknowledgement.
	 * Backends requiring durable bookkeeping reject calls without a task ID.
	 * Fluid has no durable task records and ignores this parameter.
	 * A task ID does not grant permission to complete work.
	 */
	augmentWithDiscord(
		puzzle: DocumentPuzzle,
		discordInfo: DiscordPuzzleInfo,
		durableTaskId?: string
	): void;
	/** Record a round's association, with the same durable-task semantics as puzzles. */
	augmentWithDiscord(
		round: DocumentRound,
		discordInfo: DiscordRoundInfo,
		durableTaskId?: string
	): void;
	/**
	 * Record a puzzle's Google Sheet association.
	 * @param durableTaskId Identifies persisted provisioning work to complete atomically
	 * with this association, with the same validation and retry semantics as augmentWithDiscord.
	 * Omit for a direct sheet edit or a backend without durable tasks; Fluid ignores it.
	 */
	augmentWithGoogleSheet(
		puzzle: DocumentPuzzle,
		sheetId: string,
		durableTaskId?: string
	): void;
}

/** Plain views and asynchronous settlement over the common model contract. */
export interface IPuzzlehuntModel extends IPuzzlehunt {
	readonly rounds: readonly PuzzlehuntRound[];
	readonly puzzles: readonly DocumentPuzzle[];
	readonly isPending: boolean;
	/** UI invalidation, including pending/error-only changes. */
	subscribe(listener: () => void): () => void;
	/** Wait for authoritative acknowledgement; rejects on failure or uncertainty. */
	flush(): Promise<void>;
	refresh(): Promise<void>;
}

export type PuzzlehuntSessionState =
	| { readonly status: 'open' | 'closing' | 'closed' }
	| { readonly status: 'failed'; readonly error: Error };

/** Owns a loaded model and its backend resources, without exposing SDK objects. */
export interface IPuzzlehuntSession {
	readonly id: string;
	readonly puzzlehunt: IPuzzlehuntModel;
	readonly state: PuzzlehuntSessionState;
	/**
	 * Observe lifecycle transitions. A late subscriber is notified immediately if
	 * already closed or failed. Terminal notifications release all subscriptions,
	 * including model subscriptions; the returned cleanup is always safe to call.
	 */
	subscribeLifecycle(
		listener: (state: PuzzlehuntSessionState) => void
	): () => void;
	/**
	 * Stop accepting mutations, await authoritative acknowledgement, and release
	 * resources. Repeated calls share the result; an already closed session resolves.
	 * Failure releases resources, records a terminal error, and rejects. Unexpected
	 * closure with unacknowledged edits is a failure, not a successful save.
	 * Callers must await this promise or handle its rejection, even during cleanup.
	 * Disconnection alone is not terminal; saving may wait for reconnection.
	 * Model flush/refresh reject after closure or failure.
	 */
	close(): Promise<void>;
}

/** Reuse parent-pointer ordering; child lists are read-only view values. */
export function projectPuzzlehuntView(
	document: Pick<HuntDocument, 'nodes'>
): PuzzlehuntView {
	const children = indexDocumentChildren(document);
	function roundView(round: DocumentRound): PuzzlehuntRound {
		return {
			...round,
			children: (children.get(round.id) ?? []).map((node) =>
				node.type === 'round' ? roundView(node) : node
			),
		};
	}
	const rounds: PuzzlehuntRound[] = [];
	const puzzles: DocumentPuzzle[] = [];
	function visit(node: PuzzlehuntRound | DocumentPuzzle): void {
		if (node.type === 'round') {
			rounds.push(node);
			node.children.forEach(visit);
		} else {
			puzzles.push(node);
		}
	}
	for (const node of children.get(undefined) ?? []) {
		if (node.type !== 'round') {
			throw new Error('A puzzle cannot be a root node.');
		}
		visit(roundView(node));
	}
	return { rounds, puzzles };
}

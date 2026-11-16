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
	readonly rounds: Iterable<PuzzlehuntRound>;
	readonly puzzles: Iterable<DocumentPuzzle>;
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
	augmentWithGoogleSheet(puzzle: DocumentPuzzle, sheetId: string): void;
}

/** Plain views and asynchronous settlement over the common model contract. */
export interface IPuzzlehuntModel extends IPuzzlehunt {
	readonly view: PuzzlehuntView;
	readonly rounds: readonly PuzzlehuntRound[];
	readonly puzzles: readonly DocumentPuzzle[];
	readonly isPending: boolean;
	/** UI invalidation, including pending/error-only changes. */
	subscribe(listener: () => void): () => void;
	/** Wait for authoritative acknowledgement; rejects on failure or uncertainty. */
	flush(): Promise<void>;
	refresh(): Promise<void>;
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

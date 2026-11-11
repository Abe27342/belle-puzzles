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

/** Reads and mutations shared by native Fluid handles and storage-independent views. */
export interface IPuzzlehunt<
	TPuzzle extends { readonly id: unknown },
	TRound extends { readonly id: TPuzzle['id'] },
	TNode = TPuzzle | TRound
> {
	readonly rounds: Iterable<TRound>;
	readonly puzzles: Iterable<TPuzzle>;
	getRound(id: TPuzzle['id']): TRound;
	getPuzzle(id: TPuzzle['id']): TPuzzle;
	addRound(name: string, url: string, parent?: TRound): TRound;
	addRounds(rounds: { name: string; url: string }[], parent: TRound): void;
	addPuzzle(name: string, url: string, round: TRound): TPuzzle;
	addPuzzles(puzzles: { name: string; url: string }[], round: TRound): void;
	delete(node: TNode): void;
	changeName(node: TNode, name: string): void;
	changeUrl(node: TNode, url: string): void;
	move(node: TNode, parent: TRound): void;
	solve(id: TPuzzle['id'], answer: string): TPuzzle;
	unsolve(id: TPuzzle['id']): TPuzzle;
	updateStatus(puzzle: TPuzzle, status: string): void;
	clearStatus(puzzle: TPuzzle): void;
	augmentWithGoogleSheet(puzzle: TPuzzle, sheetId: string): void;
}

/** Plain views and asynchronous settlement over the common model contract. */
export interface IPuzzlehuntModel
	extends IPuzzlehunt<DocumentPuzzle, PuzzlehuntRound, DocumentNode> {
	readonly view: PuzzlehuntView;
	readonly rounds: readonly PuzzlehuntRound[];
	readonly puzzles: readonly DocumentPuzzle[];
	readonly isPending: boolean;
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
	for (const node of children.get(null) ?? []) {
		if (node.type !== 'round') {
			throw new Error('A puzzle cannot be a root node.');
		}
		visit(roundView(node));
	}
	return { rounds, puzzles };
}

import { documentChildren } from '../document.js';
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

/** Representation-independent reads and locally visible mutations. */
export interface IPuzzlehuntModel {
	readonly view: PuzzlehuntView;
	readonly rounds: readonly PuzzlehuntRound[];
	readonly puzzles: readonly DocumentPuzzle[];
	readonly isPending: boolean;
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
	subscribe(listener: () => void): () => void;
	/** Wait for authoritative acknowledgement; rejects on failure or uncertainty. */
	flush(): Promise<void>;
	refresh(): Promise<void>;
}

/** Reuse parent-pointer ordering; child lists are read-only view values. */
export function projectPuzzlehuntView(document: HuntDocument): PuzzlehuntView {
	function roundView(round: DocumentRound): PuzzlehuntRound {
		return {
			...round,
			children: documentChildren(document, round.id).map((node) =>
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
	for (const node of documentChildren(document, null)) {
		if (node.type !== 'round') {
			throw new Error('A puzzle cannot be a root node.');
		}
		visit(roundView(node));
	}
	return { rounds, puzzles };
}

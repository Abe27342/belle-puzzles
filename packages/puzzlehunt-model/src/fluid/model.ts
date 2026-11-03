import { SharedTree } from '@fluid-experimental/tree';
import type { IFluidContainer } from '@fluidframework/fluid-static';
import { HuntCommandError } from '../document.js';
import type { DocumentNode, DocumentPuzzle } from '../document.js';
import type { IPuzzlehunt, Puzzle, Round } from '../puzzlehunt.js';
import { projectPuzzlehuntView } from '../model/types.js';
import type {
	IPuzzlehuntModel,
	PuzzlehuntRound,
	PuzzlehuntView,
} from '../model/types.js';

/** Adapt the existing Fluid model; preserve its existing domain behavior. */
export class FluidPuzzlehuntModel implements IPuzzlehuntModel {
	private readonly tree: SharedTree;

	constructor(
		private readonly hunt: IPuzzlehunt,
		private readonly container: IFluidContainer
	) {
		const tree = container.initialObjects.hunt;
		if (!(tree instanceof SharedTree)) {
			throw new Error('Fluid puzzlehunt container has no SharedTree.');
		}
		this.tree = tree;
	}

	get view(): PuzzlehuntView {
		const nodes: Record<string, DocumentNode> = {};
		const visit = (
			round: Round,
			parentId: string | null,
			position: number
		) => {
			const id = this.tree.convertToStableNodeId(round.id);
			nodes[id] = {
				id,
				type: 'round',
				name: round.name,
				url: round.url,
				parentId,
				position,
				...(round.discordInfo ? { discord: round.discordInfo } : {}),
			};
			round.children.forEach((child, index) => {
				if (child.type === 'round') {
					visit(child, id, index);
				} else {
					const puzzleId = this.tree.convertToStableNodeId(child.id);
					nodes[puzzleId] = {
						id: puzzleId,
						type: 'puzzle',
						name: child.name,
						url: child.url,
						parentId: id,
						position: index,
						...(child.answer === undefined
							? {}
							: { answer: child.answer }),
						...(child.status === undefined
							? {}
							: { status: child.status }),
						...(child.lastStatusUpdate === undefined
							? {}
							: { lastStatusUpdate: child.lastStatusUpdate }),
						...(child.sheetId === undefined
							? {}
							: { sheetId: child.sheetId }),
						...(child.discordInfo
							? { discord: child.discordInfo }
							: {}),
					};
				}
			});
		};
		Array.from(this.hunt.rounds)
			.filter((round) => round.roundId === undefined)
			.forEach((round, position) => visit(round, null, position));
		return projectPuzzlehuntView({ nodes });
	}

	get rounds(): readonly PuzzlehuntRound[] {
		return this.view.rounds;
	}

	get puzzles(): readonly DocumentPuzzle[] {
		return this.view.puzzles;
	}

	get isPending(): boolean {
		return this.container.isDirty;
	}

	getRound(id: string): PuzzlehuntRound {
		const round = this.rounds.find((node) => node.id === id);
		if (!round) {
			throw new HuntCommandError('not-found', 'Round not found.');
		}
		return round;
	}

	getPuzzle(id: string): DocumentPuzzle {
		const puzzle = this.puzzles.find((node) => node.id === id);
		if (!puzzle) {
			throw new HuntCommandError('not-found', 'Puzzle not found.');
		}
		return puzzle;
	}

	addRound(
		name: string,
		url: string,
		parent?: PuzzlehuntRound
	): PuzzlehuntRound {
		const round = this.hunt.addRound(
			name,
			url,
			parent ? this.nativeRound(parent.id) : undefined
		);
		return this.getRound(this.tree.convertToStableNodeId(round.id));
	}

	addRounds(
		rounds: { name: string; url: string }[],
		parent: PuzzlehuntRound
	): void {
		this.hunt.addRounds(rounds, this.nativeRound(parent.id));
	}

	addPuzzle(
		name: string,
		url: string,
		round: PuzzlehuntRound
	): DocumentPuzzle {
		const puzzle = this.hunt.addPuzzle(
			name,
			url,
			this.nativeRound(round.id)
		);
		return this.getPuzzle(this.tree.convertToStableNodeId(puzzle.id));
	}

	addPuzzles(
		puzzles: { name: string; url: string }[],
		round: PuzzlehuntRound
	): void {
		this.hunt.addPuzzles(puzzles, this.nativeRound(round.id));
	}

	delete(node: DocumentNode): void {
		this.hunt.delete(this.nativeNode(node.id));
	}

	changeName(node: DocumentNode, name: string): void {
		this.hunt.changeName(this.nativeNode(node.id), name);
	}

	changeUrl(node: DocumentNode, url: string): void {
		this.hunt.changeUrl(this.nativeNode(node.id), url);
	}

	move(node: DocumentNode, parent: PuzzlehuntRound): void {
		this.hunt.move(this.nativeNode(node.id), this.nativeRound(parent.id));
	}

	solve(id: string, answer: string): DocumentPuzzle {
		this.hunt.solve(this.nativePuzzle(id).id, answer);
		return this.getPuzzle(id);
	}

	unsolve(id: string): DocumentPuzzle {
		this.hunt.unsolve(this.nativePuzzle(id).id);
		return this.getPuzzle(id);
	}

	updateStatus(puzzle: DocumentPuzzle, status: string): void {
		this.hunt.updateStatus(this.nativePuzzle(puzzle.id), status);
	}

	clearStatus(puzzle: DocumentPuzzle): void {
		this.hunt.clearStatus(this.nativePuzzle(puzzle.id));
	}

	augmentWithGoogleSheet(puzzle: DocumentPuzzle, sheetId: string): void {
		this.hunt.augmentWithGoogleSheet(this.nativePuzzle(puzzle.id), sheetId);
	}

	subscribe(listener: () => void): () => void {
		const notify = () => listener();
		this.hunt.on('viewChange', notify);
		this.container.on('dirty', notify);
		this.container.on('saved', notify);
		return () => {
			this.hunt.off('viewChange', notify);
			this.container.off('dirty', notify);
			this.container.off('saved', notify);
		};
	}

	flush(): Promise<void> {
		if (this.container.disposed) {
			return Promise.reject(
				new Error('Fluid puzzlehunt container is disposed.')
			);
		}
		if (!this.container.isDirty) {
			return Promise.resolve();
		}
		return new Promise<void>((resolve, reject) => {
			const cleanup = () => {
				this.container.off('saved', saved);
				this.container.off('disposed', disposed);
			};
			const saved = () => {
				cleanup();
				resolve();
			};
			const disposed = (error?: unknown) => {
				cleanup();
				reject(
					error ??
						new Error(
							'Fluid puzzlehunt closed before acknowledgement.'
						)
				);
			};
			this.container.on('saved', saved);
			this.container.on('disposed', disposed);
		});
	}

	/** Fluid streams remote edits continuously; only local acknowledgement needs flushing. */
	refresh(): Promise<void> {
		return this.flush();
	}

	private nativeNode(id: string): Puzzle | Round {
		const node = [...this.hunt.rounds, ...this.hunt.puzzles].find(
			(node) => this.tree.convertToStableNodeId(node.id) === id
		);
		if (!node) {
			throw new HuntCommandError('not-found', 'Node not found.');
		}
		return node;
	}

	private nativeRound(id: string): Round {
		const node = this.nativeNode(id);
		if (node.type !== 'round') {
			throw new HuntCommandError('invalid-command', 'Expected a round.');
		}
		return node;
	}

	private nativePuzzle(id: string): Puzzle {
		const node = this.nativeNode(id);
		if (node.type !== 'puzzle') {
			throw new HuntCommandError('invalid-command', 'Expected a puzzle.');
		}
		return node;
	}
}

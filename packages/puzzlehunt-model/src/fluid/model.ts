import { SharedTree } from '@fluid-experimental/tree';
import type { IFluidContainer } from '@fluidframework/fluid-static';
import type { DocumentNode, DocumentPuzzle } from '../document.js';
import type { IPuzzlehunt } from '../puzzlehunt.js';
import type {
	IPuzzlehuntModel,
	PuzzlehuntRound,
	PuzzlehuntView,
	PuzzlehuntChangeEvent,
} from '../model/types.js';

/** Adapt the existing Fluid model; preserve its existing domain behavior. */
export class FluidPuzzlehuntModel implements IPuzzlehuntModel {
	constructor(
		private readonly hunt: IPuzzlehunt,
		private readonly container: IFluidContainer
	) {
		const tree = container.initialObjects.hunt;
		if (!(tree instanceof SharedTree)) {
			throw new Error('Fluid puzzlehunt container has no SharedTree.');
		}
	}

	get view(): PuzzlehuntView {
		return this.hunt.view;
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
		return this.hunt.getRound(id);
	}

	getPuzzle(id: string): DocumentPuzzle {
		return this.hunt.getPuzzle(id);
	}

	addRound(
		name: string,
		url: string,
		parent?: PuzzlehuntRound
	): PuzzlehuntRound {
		return this.hunt.addRound(name, url, parent);
	}

	addRounds(
		rounds: { name: string; url: string }[],
		parent: PuzzlehuntRound
	): void {
		this.hunt.addRounds(rounds, parent);
	}

	addPuzzle(
		name: string,
		url: string,
		round: PuzzlehuntRound
	): DocumentPuzzle {
		return this.hunt.addPuzzle(name, url, round);
	}

	addPuzzles(
		puzzles: { name: string; url: string }[],
		round: PuzzlehuntRound
	): void {
		this.hunt.addPuzzles(puzzles, round);
	}

	delete(node: DocumentNode): void {
		this.hunt.delete(node);
	}

	changeName(node: DocumentNode, name: string): void {
		this.hunt.changeName(node, name);
	}

	changeUrl(node: DocumentNode, url: string): void {
		this.hunt.changeUrl(node, url);
	}

	move(node: DocumentNode, parent: PuzzlehuntRound): void {
		this.hunt.move(node, parent);
	}

	solve(id: string, answer: string): DocumentPuzzle {
		return this.hunt.solve(id, answer);
	}

	unsolve(id: string): DocumentPuzzle {
		return this.hunt.unsolve(id);
	}

	updateStatus(puzzle: DocumentPuzzle, status: string): void {
		this.hunt.updateStatus(puzzle, status);
	}

	clearStatus(puzzle: DocumentPuzzle): void {
		this.hunt.clearStatus(puzzle);
	}

	augmentWithGoogleSheet(puzzle: DocumentPuzzle, sheetId: string): void {
		this.hunt.augmentWithGoogleSheet(puzzle, sheetId);
	}

	subscribe(listener: () => void): () => void {
		const notify = () => listener();
		const unsubscribe = this.hunt.subscribeChanges(notify);
		this.container.on('dirty', notify);
		this.container.on('saved', notify);
		return () => {
			unsubscribe();
			this.container.off('dirty', notify);
			this.container.off('saved', notify);
		};
	}

	subscribeChanges(
		listener: (event: PuzzlehuntChangeEvent) => void
	): () => void {
		return this.hunt.subscribeChanges(listener);
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
}

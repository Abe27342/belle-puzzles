import {
	IPuzzlehunt,
	loadExistingPuzzlehunt,
} from '@belle-puzzles/puzzlehunt-model';
import { makeFluidClient } from './fluid/client.js';

export interface IPuzzlehuntProvider {
	getPuzzlehunt(
		id: string,
		onInitialLoad?: (puzzlehunt: IPuzzlehunt) => void
	): Promise<IPuzzlehunt>;
}

// 10 minutes
// TODO: There's nothing stopping a race condition where we close a container while a
// long-running interaction is trying to use it. This probably isn't an issue for now, but could be.
const DEFAULT_TIMEOUT = 1000 * 60 * 10;

class PuzzlehuntProvider implements IPuzzlehuntProvider {
	private readonly openFiles: Map<
		string,
		{
			puzzlehunt: IPuzzlehunt;
			disposer: { dispose: () => void };
			timeoutId: NodeJS.Timeout;
		}
	> = new Map();

	// TODO: Some kind of cache eviction would be nice.
	// By default, keep fluid files open for 10 minutes before disposing.
	constructor(private readonly timeout: number = DEFAULT_TIMEOUT) {}

	public async getPuzzlehunt(
		id: string,
		onInitialLoad?: (puzzlehunt: IPuzzlehunt) => void
	): Promise<IPuzzlehunt> {
		if (!this.openFiles.has(id)) {
			const { puzzlehunt, disposer } = await loadExistingPuzzlehunt(
				makeFluidClient(),
				id
			);
			if (this.openFiles.has(id)) {
				// Another interaction may have attempted to load the same file. If this happened,
				// just use the existing file (disposer/id/puzzlehunt should all be set reasonably accurately
				// if this has happened) and dispose the one we just loaded to avoid memory leak.
				disposer.dispose();
				return puzzlehunt;
			}
			onInitialLoad?.(puzzlehunt);
			this.cacheFile(id, puzzlehunt, disposer);
			return puzzlehunt;
		} else {
			const { puzzlehunt, disposer, timeoutId } = this.openFiles.get(id);
			clearTimeout(timeoutId);
			this.cacheFile(id, puzzlehunt, disposer);
			return puzzlehunt;
		}
	}

	private cacheFile(
		id: string,
		puzzlehunt: IPuzzlehunt,
		disposer: { dispose: () => void }
	): void {
		const timeoutId = setTimeout(() => {
			this.openFiles.delete(id);
			console.log(
				`Closing file ${id} due to inactivity for ${this.timeout} ms.`
			);
			disposer.dispose();
		}, this.timeout);
		this.openFiles.set(id, { puzzlehunt, disposer, timeoutId });
	}
}

export function createPuzzlehuntProvider(): IPuzzlehuntProvider {
	return new PuzzlehuntProvider();
}

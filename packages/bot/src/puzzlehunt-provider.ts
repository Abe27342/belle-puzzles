import {
	IPuzzlehunt,
	IPuzzlehuntSession,
} from '@belle-puzzles/puzzlehunt-model';
import { loadExistingPuzzlehunt } from '@belle-puzzles/puzzlehunt-model/fluid';
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
			session: IPuzzlehuntSession;
			timeoutId: NodeJS.Timeout;
			unsubscribeLifecycle: () => void;
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
			const session = await loadExistingPuzzlehunt(makeFluidClient(), id);
			if (this.openFiles.has(id)) {
				// Another interaction may have attempted to load the same file. If this happened,
				// just use the existing file (session/id/puzzlehunt should all be set reasonably accurately
				// if this has happened) and dispose the one we just loaded to avoid memory leak.
				await session.close();
				return this.getPuzzlehunt(id, onInitialLoad);
			}
			try {
				onInitialLoad?.(session.puzzlehunt);
			} catch (error) {
				await session.close();
				throw error;
			}
			this.cacheFile(id, session);
			return session.puzzlehunt;
		} else {
			const { session, timeoutId, unsubscribeLifecycle } =
				this.openFiles.get(id);
			clearTimeout(timeoutId);
			unsubscribeLifecycle();
			this.cacheFile(id, session);
			return session.puzzlehunt;
		}
	}

	private cacheFile(id: string, session: IPuzzlehuntSession): void {
		if (session.state.status === 'failed') {
			throw session.state.error;
		}
		if (session.state.status !== 'open') {
			throw new Error(`Puzzlehunt ${id} is not open.`);
		}
		const timeoutId = setTimeout(() => {
			this.openFiles.delete(id);
			entry.unsubscribeLifecycle();
			console.log(
				`Closing file ${id} due to inactivity for ${this.timeout} ms.`
			);
			void session.close().catch((error) => {
				console.error(`Failed to close puzzlehunt ${id}.`, error);
			});
		}, this.timeout);
		const entry = {
			session,
			timeoutId,
			unsubscribeLifecycle: () => {},
		};
		this.openFiles.set(id, entry);
		entry.unsubscribeLifecycle = session.subscribeLifecycle((state) => {
			if (state.status === 'closed' || state.status === 'failed') {
				clearTimeout(timeoutId);
				if (this.openFiles.get(id)?.session === session) {
					this.openFiles.delete(id);
				}
				if (state.status === 'failed') {
					console.error(`Puzzlehunt ${id} failed.`, state.error);
				}
			}
		});
	}
}

export function createPuzzlehuntProvider(): IPuzzlehuntProvider {
	return new PuzzlehuntProvider();
}

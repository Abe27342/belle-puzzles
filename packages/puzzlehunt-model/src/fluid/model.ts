import { SharedTree } from '@fluid-experimental/tree';
import { SharedMap } from 'fluid-framework';
import type { IFluidContainer } from '@fluidframework/fluid-static';
import type { Puzzlehunt } from '../puzzlehunt.js';
import { HuntCommandError } from '../document.js';
import type {
	DocumentNode,
	DocumentPuzzle,
	DocumentRound,
} from '../document.js';
import type {
	DiscordPuzzleInfo,
	DiscordRoundInfo,
	IPuzzlehuntModel,
	IPuzzlehuntSession,
	LoggingChannelIds,
	PuzzlehuntRound,
	PuzzlehuntView,
	PuzzlehuntChangeEvent,
	PuzzlehuntSessionState,
} from '../model/types.js';

/** Adapt the existing Fluid model; preserve its existing domain behavior. */
export class FluidPuzzlehuntSession
	implements IPuzzlehuntModel, IPuzzlehuntSession
{
	readonly puzzlehunt: IPuzzlehuntModel = this;
	private readonly guildInfo: SharedMap;
	private currentState: PuzzlehuntSessionState = { status: 'open' };
	private readonly lifecycleListeners = new Set<
		(state: PuzzlehuntSessionState) => void
	>();
	private readonly subscriptions = new Set<() => void>();
	private readonly flushWaiters = new Set<{
		resolve: () => void;
		reject: (error: Error) => void;
	}>();
	private readonly unsubscribeErrors: () => void;

	constructor(
		private readonly hunt: Puzzlehunt,
		private readonly container: IFluidContainer
	) {
		const tree = container.initialObjects.hunt;
		if (!(tree instanceof SharedTree)) {
			throw new Error('Fluid puzzlehunt container has no SharedTree.');
		}
		const guildInfo = container.initialObjects.guildInfo;
		if (!(guildInfo instanceof SharedMap)) {
			throw new Error(
				'Fluid puzzlehunt container has no guild metadata.'
			);
		}
		this.guildInfo = guildInfo;
		this.unsubscribeErrors = hunt.subscribeErrors((error) =>
			this.fail(error)
		);
		container.on('saved', this.saved);
		container.on('disposed', this.disposed);
		if (container.disposed) {
			this.disposed();
		}
	}

	get state(): PuzzlehuntSessionState {
		return this.currentState;
	}

	subscribeLifecycle(
		listener: (state: PuzzlehuntSessionState) => void
	): () => void {
		if (this.state.status === 'closed' || this.state.status === 'failed') {
			return () => {};
		}
		this.lifecycleListeners.add(listener);
		return () => {
			this.lifecycleListeners.delete(listener);
		};
	}

	close(): void {
		try {
			this.finish({ status: 'closed' });
		} finally {
			if (!this.container.disposed) {
				this.container.dispose();
			}
		}
	}

	private assertWritable(): void {
		if (this.state.status === 'failed') {
			throw this.state.error;
		}
		if (this.state.status !== 'open') {
			throw new Error('Puzzlehunt session is closed.');
		}
	}

	private publishLifecycle(): void {
		for (const listener of this.lifecycleListeners) {
			listener(this.state);
		}
	}

	private finish(state: PuzzlehuntSessionState): void {
		if (this.state.status === 'closed' || this.state.status === 'failed') {
			return;
		}
		this.currentState = state;
		const error =
			state.status === 'failed'
				? state.error
				: new Error('Puzzlehunt session is closed.');
		for (const waiter of this.flushWaiters) {
			waiter.reject(error);
		}
		this.flushWaiters.clear();
		this.container.off('saved', this.saved);
		this.container.off('disposed', this.disposed);
		this.unsubscribeErrors();
		try {
			this.publishLifecycle();
		} finally {
			for (const unsubscribe of this.subscriptions) {
				unsubscribe();
			}
			this.lifecycleListeners.clear();
		}
	}

	private fail(error: unknown): Error {
		const failure =
			this.state.status === 'failed'
				? this.state.error
				: error instanceof Error
				? error
				: new Error('Puzzlehunt session failed.', { cause: error });
		try {
			this.finish({ status: 'failed', error: failure });
		} finally {
			if (!this.container.disposed) {
				this.container.dispose();
			}
		}
		return failure;
	}

	private readonly disposed = (error?: unknown): void => {
		this.finish(
			error !== undefined || this.container.isDirty
				? {
						status: 'failed',
						error:
							error instanceof Error
								? error
								: new Error(
										'Puzzlehunt closed before acknowledgement.',
										{ cause: error }
								  ),
				  }
				: { status: 'closed' }
		);
	};

	private readonly saved = (): void => {
		if (!this.container.isDirty) {
			for (const waiter of this.flushWaiters) {
				waiter.resolve();
			}
			this.flushWaiters.clear();
		}
	};

	get view(): PuzzlehuntView {
		return this.hunt.view;
	}

	get rounds(): readonly PuzzlehuntRound[] {
		return Array.from(this.hunt.rounds);
	}

	get puzzles(): readonly DocumentPuzzle[] {
		return Array.from(this.hunt.puzzles);
	}

	get isPending(): boolean {
		return this.container.isDirty;
	}

	get guildId(): string {
		return this.hunt.guildId;
	}

	get loggingChannelIds(): LoggingChannelIds | undefined {
		return this.hunt.loggingChannelIds;
	}

	setLoggingChannelIds(ids: LoggingChannelIds): void {
		this.assertWritable();
		this.hunt.setLoggingChannelIds(ids);
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
		this.assertWritable();
		return this.hunt.addRound(name, url, parent);
	}

	addRounds(
		rounds: { name: string; url: string }[],
		parent: PuzzlehuntRound
	): void {
		this.assertWritable();
		this.hunt.addRounds(rounds, parent);
	}

	addPuzzle(
		name: string,
		url: string,
		round: PuzzlehuntRound
	): DocumentPuzzle {
		this.assertWritable();
		return this.hunt.addPuzzle(name, url, round);
	}

	addPuzzles(
		puzzles: { name: string; url: string }[],
		round: PuzzlehuntRound
	): void {
		this.assertWritable();
		this.hunt.addPuzzles(puzzles, round);
	}

	delete(node: DocumentNode): void {
		this.assertWritable();
		this.hunt.delete(node);
	}

	changeName(node: DocumentNode, name: string): void {
		this.assertWritable();
		this.hunt.changeName(node, name);
	}

	changeUrl(node: DocumentNode, url: string): void {
		this.assertWritable();
		this.hunt.changeUrl(node, url);
	}

	move(node: DocumentNode, parent: PuzzlehuntRound): void {
		this.assertWritable();
		this.hunt.move(node, parent);
	}

	solve(id: string, answer: string): DocumentPuzzle {
		this.assertWritable();
		return this.hunt.solve(id, answer);
	}

	unsolve(id: string): DocumentPuzzle {
		this.assertWritable();
		return this.hunt.unsolve(id);
	}

	updateStatus(puzzle: DocumentPuzzle, status: string): void {
		this.assertWritable();
		this.hunt.updateStatus(puzzle, status);
	}

	clearStatus(puzzle: DocumentPuzzle): void {
		this.assertWritable();
		this.hunt.clearStatus(puzzle);
	}

	augmentWithDiscord(
		puzzle: DocumentPuzzle,
		discordInfo: DiscordPuzzleInfo,
		durableTaskId?: string
	): void;
	augmentWithDiscord(
		round: DocumentRound,
		discordInfo: DiscordRoundInfo,
		durableTaskId?: string
	): void;
	augmentWithDiscord(
		node: DocumentNode,
		discordInfo: DiscordPuzzleInfo | DiscordRoundInfo,
		durableTaskId?: string
	): void {
		this.assertWritable();
		if (node.type === 'puzzle') {
			this.hunt.augmentWithDiscord(node, discordInfo, durableTaskId);
		} else if ('indexChannel' in discordInfo) {
			this.hunt.augmentWithDiscord(node, discordInfo, durableTaskId);
		} else {
			throw new HuntCommandError(
				'invalid-command',
				'A round Discord association requires an index channel.'
			);
		}
	}

	augmentWithGoogleSheet(
		puzzle: DocumentPuzzle,
		sheetId: string,
		durableTaskId?: string
	): void {
		this.assertWritable();
		this.hunt.augmentWithGoogleSheet(puzzle, sheetId, durableTaskId);
	}

	subscribe(listener: () => void): () => void {
		if (this.state.status === 'closed' || this.state.status === 'failed') {
			listener();
			return () => {};
		}
		const notify = () => listener();
		const unsubscribe = this.hunt.subscribeChanges(notify);
		const unsubscribeLifecycle = this.subscribeLifecycle(notify);
		this.guildInfo.on('valueChanged', notify);
		this.container.on('dirty', notify);
		this.container.on('saved', notify);
		const cleanup = () => {
			unsubscribe();
			unsubscribeLifecycle();
			this.guildInfo.off('valueChanged', notify);
			this.container.off('dirty', notify);
			this.container.off('saved', notify);
			this.subscriptions.delete(cleanup);
		};
		this.subscriptions.add(cleanup);
		return cleanup;
	}

	subscribeChanges(
		listener: (event: PuzzlehuntChangeEvent) => void
	): () => void {
		if (this.state.status === 'closed' || this.state.status === 'failed') {
			return () => {};
		}
		const unsubscribe = this.hunt.subscribeChanges(listener);
		const cleanup = () => {
			unsubscribe();
			this.subscriptions.delete(cleanup);
		};
		this.subscriptions.add(cleanup);
		return cleanup;
	}

	flush(): Promise<void> {
		if (this.container.disposed && this.state.status !== 'failed') {
			this.disposed();
		}
		if (this.state.status === 'failed') {
			return Promise.reject(this.state.error);
		}
		if (this.state.status === 'closed') {
			return Promise.reject(new Error('Puzzlehunt session is closed.'));
		}
		if (!this.container.isDirty) {
			return Promise.resolve();
		}
		return new Promise<void>((resolve, reject) => {
			this.flushWaiters.add({ resolve, reject });
			this.saved();
		});
	}

	/** Fluid streams remote edits continuously; only local acknowledgement needs flushing. */
	refresh(): Promise<void> {
		return this.flush();
	}
}

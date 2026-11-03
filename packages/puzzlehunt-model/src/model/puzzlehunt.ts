import {
	applyHuntCommand,
	assertHuntDocument,
	HuntCommandError,
} from '../document.js';
import type {
	DocumentNode,
	DocumentPuzzle,
	HuntCommand,
	HuntCommandRequest,
	HuntDocument,
	HuntDocumentClient,
	HuntScope,
	HuntSnapshot,
} from '../document.js';
import { projectPuzzlehuntView } from './types.js';
import type {
	IPuzzlehuntModel,
	PuzzlehuntRound,
	PuzzlehuntView,
} from './types.js';

export interface PendingHuntChange {
	readonly request: HuntCommandRequest;
	readonly status: 'pending' | 'uncertain';
	readonly error?: Error;
}

export interface HuntModelFailure {
	readonly request?: HuntCommandRequest;
	readonly error: Error;
}

interface CommandOperation {
	type: 'command';
	request: HuntCommandRequest;
	optimisticTime: number;
	status: 'pending' | 'uncertain';
	error?: Error;
}

type Operation = CommandOperation | { type: 'refresh' };

function asError(error: unknown): Error {
	return error instanceof Error
		? error
		: new Error('Puzzlehunt operation failed.', { cause: error });
}

/** Optimistic client over semantic commands, not a particular storage engine. */
export class PuzzlehuntModel implements IPuzzlehuntModel {
	private committed: HuntSnapshot;
	private readonly scope: HuntScope;
	private projected: HuntDocument;
	private readonly operations: Operation[] = [];
	private readonly listeners = new Set<() => void>();
	private readonly failed: HuntModelFailure[] = [];
	private draining: Promise<void> | undefined;
	private lastDrain: Promise<void> = Promise.resolve();

	constructor(
		private readonly client: HuntDocumentClient,
		snapshot: HuntSnapshot
	) {
		this.committed = snapshot;
		this.scope = { huntId: snapshot.huntId, guildId: snapshot.guildId };
		this.validateSnapshot(snapshot);
		this.projected = snapshot.document;
	}

	static async load(
		client: HuntDocumentClient,
		scope: HuntScope
	): Promise<PuzzlehuntModel> {
		const snapshot = await client.read(scope);
		if (
			snapshot.huntId !== scope.huntId ||
			snapshot.guildId !== scope.guildId
		) {
			throw new Error('Puzzlehunt read returned a different scope.');
		}
		return new PuzzlehuntModel(client, snapshot);
	}

	get committedSnapshot(): HuntSnapshot {
		return this.committed;
	}

	get view(): PuzzlehuntView {
		return projectPuzzlehuntView(this.projected);
	}

	get rounds(): readonly PuzzlehuntRound[] {
		return this.view.rounds;
	}

	get puzzles(): readonly DocumentPuzzle[] {
		return this.view.puzzles;
	}

	get pendingChanges(): readonly PendingHuntChange[] {
		return this.operations
			.filter((op): op is CommandOperation => op.type === 'command')
			.map(({ request, status, error }) => ({ request, status, error }));
	}

	get isPending(): boolean {
		return this.pendingChanges.length > 0;
	}

	get failures(): readonly HuntModelFailure[] {
		return this.failed;
	}

	clearFailures(): void {
		this.failed.length = 0;
		this.publish();
	}

	getRound(id: string): PuzzlehuntRound {
		const round = this.rounds.find((node) => node.id === id);
		if (!round) {
			throw new HuntCommandError('not-found', 'Round not found.');
		}
		return round;
	}

	getPuzzle(id: string): DocumentPuzzle {
		const puzzle = this.projected.nodes[id];
		if (!puzzle || puzzle.type !== 'puzzle') {
			throw new HuntCommandError('not-found', 'Puzzle not found.');
		}
		return puzzle;
	}

	addRound(
		name: string,
		url: string,
		parent?: PuzzlehuntRound
	): PuzzlehuntRound {
		const id = crypto.randomUUID();
		this.dispatch({
			type: 'add',
			nodes: [
				{ id, type: 'round', name, url, parentId: parent?.id ?? null },
			],
		});
		return this.getRound(id);
	}

	addRounds(
		rounds: { name: string; url: string }[],
		parent: PuzzlehuntRound
	): void {
		this.dispatch({
			type: 'add',
			nodes: rounds.map(({ name, url }) => ({
				id: crypto.randomUUID(),
				type: 'round',
				name,
				url,
				parentId: parent.id,
			})),
		});
	}

	addPuzzle(
		name: string,
		url: string,
		round: PuzzlehuntRound
	): DocumentPuzzle {
		const id = crypto.randomUUID();
		this.dispatch({
			type: 'add',
			nodes: [{ id, type: 'puzzle', name, url, parentId: round.id }],
		});
		return this.getPuzzle(id);
	}

	addPuzzles(
		puzzles: { name: string; url: string }[],
		round: PuzzlehuntRound
	): void {
		this.dispatch({
			type: 'add',
			nodes: puzzles.map(({ name, url }) => ({
				id: crypto.randomUUID(),
				type: 'puzzle',
				name,
				url,
				parentId: round.id,
			})),
		});
	}

	delete(node: DocumentNode): void {
		this.dispatch({ type: 'delete', nodeId: node.id });
	}

	changeName(node: DocumentNode, name: string): void {
		this.dispatch({ type: 'rename', nodeId: node.id, name });
	}

	changeUrl(node: DocumentNode, url: string): void {
		this.dispatch({ type: 'set-url', nodeId: node.id, url });
	}

	move(node: DocumentNode, parent: PuzzlehuntRound): void {
		this.dispatch({ type: 'move', nodeId: node.id, parentId: parent.id });
	}

	solve(id: string, answer: string): DocumentPuzzle {
		this.dispatch({ type: 'solve', nodeId: id, answer });
		return this.getPuzzle(id);
	}

	unsolve(id: string): DocumentPuzzle {
		this.dispatch({ type: 'unsolve', nodeId: id });
		return this.getPuzzle(id);
	}

	updateStatus(puzzle: DocumentPuzzle, status: string): void {
		this.dispatch({ type: 'set-status', nodeId: puzzle.id, status });
	}

	clearStatus(puzzle: DocumentPuzzle): void {
		this.dispatch({ type: 'set-status', nodeId: puzzle.id, status: null });
	}

	augmentWithGoogleSheet(puzzle: DocumentPuzzle, sheetId: string): void {
		this.dispatch({ type: 'set-sheet', nodeId: puzzle.id, sheetId });
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** Commands and snapshots supplied to this model must be treated as immutable. */
	dispatch(command: HuntCommand): string {
		const optimisticTime = Date.now();
		this.projected = applyHuntCommand(
			this.projected,
			command,
			optimisticTime
		).document;
		const commandId = crypto.randomUUID();
		this.operations.push({
			type: 'command',
			request: { commandId, command },
			optimisticTime,
			status: 'pending',
		});
		this.start();
		this.publish();
		return commandId;
	}

	flush(): Promise<void> {
		const front = this.operations[0];
		if (front?.type === 'command' && front.status === 'uncertain') {
			return Promise.reject(front.error);
		}
		return this.draining ?? this.lastDrain;
	}

	/** Refreshes share the command pipeline so a read cannot double-project an in-flight add. */
	refresh(): Promise<void> {
		this.operations.push({ type: 'refresh' });
		this.start();
		return this.flush();
	}

	async retryPending(): Promise<void> {
		if (this.draining) {
			// A subscriber can request retry while the failed attempt is still unwinding.
			await Promise.allSettled([this.draining]);
		}
		const front = this.operations[0];
		if (front?.type === 'command' && front.status === 'uncertain') {
			front.status = 'pending';
			delete front.error;
		}
		this.start();
		return this.flush();
	}

	private start(): void {
		const front = this.operations[0];
		if (
			this.draining ||
			!front ||
			(front.type === 'command' && front.status === 'uncertain')
		) {
			return;
		}
		const running = Promise.resolve().then(() => this.drain());
		this.draining = this.lastDrain = running;
		// Failures remain visible through flush(), failures, and pendingChanges.
		void running.then(
			() => {
				this.draining = undefined;
			},
			() => {
				this.draining = undefined;
			}
		);
	}

	private async drain(): Promise<void> {
		const errors: Error[] = [];
		while (this.operations.length > 0) {
			const operation = this.operations[0];
			if (operation.type === 'refresh') {
				try {
					this.accept(await this.client.read(this.scope));
				} catch (error) {
					this.recordFailure(undefined, error, errors);
				}
				this.operations.shift();
			} else {
				try {
					const result = await this.client.submit(
						this.scope,
						operation.request
					);
					if (
						result.receipt.commandId !==
							operation.request.commandId ||
						!Number.isSafeInteger(
							result.receipt.committedRevision
						) ||
						result.receipt.committedRevision < 0 ||
						result.receipt.committedRevision >
							result.snapshot.revision
					) {
						throw new Error(
							'Invalid puzzlehunt command acknowledgement.'
						);
					}
					this.accept(result.snapshot);
					this.operations.shift();
				} catch (error) {
					if (!(error instanceof HuntCommandError)) {
						operation.status = 'uncertain';
						const failure = asError(error);
						operation.error = failure;
						this.publish();
						throw failure;
					}
					this.operations.shift();
					this.recordFailure(operation.request, error, errors);
				}
			}
			this.rebase(errors);
			this.publish();
		}
		if (errors.length > 0) {
			throw new AggregateError(errors, 'Puzzlehunt changes failed.');
		}
	}

	private rebase(errors: Error[]): void {
		let document = this.committed.document;
		for (let i = 0; i < this.operations.length; i++) {
			const operation = this.operations[i];
			if (operation.type === 'refresh') {
				continue;
			}
			try {
				document = applyHuntCommand(
					document,
					operation.request.command,
					operation.optimisticTime
				).document;
			} catch (error) {
				if (!(error instanceof HuntCommandError)) {
					throw error;
				}
				this.operations.splice(i--, 1);
				this.recordFailure(operation.request, error, errors);
			}
		}
		this.projected = document;
	}

	private recordFailure(
		request: HuntCommandRequest | undefined,
		error: unknown,
		errors: Error[]
	): void {
		const failure = { request, error: asError(error) };
		this.failed.push(failure);
		errors.push(failure.error);
	}

	private validateSnapshot(snapshot: HuntSnapshot): void {
		if (
			snapshot.huntId !== this.committed.huntId ||
			snapshot.guildId !== this.committed.guildId ||
			snapshot.schemaVersion !== 1 ||
			!Number.isSafeInteger(snapshot.revision) ||
			snapshot.revision < 0
		) {
			throw new Error('Invalid puzzlehunt snapshot scope or revision.');
		}
		assertHuntDocument(snapshot.document);
	}

	private accept(snapshot: HuntSnapshot): void {
		this.validateSnapshot(snapshot);
		if (snapshot.revision >= this.committed.revision) {
			this.committed = snapshot;
		}
	}

	private publish(): void {
		for (const listener of this.listeners) {
			listener();
		}
	}
}

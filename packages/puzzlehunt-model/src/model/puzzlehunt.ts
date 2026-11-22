import {
	applyHuntCommand,
	validateHuntDocument,
	HuntCommandError,
	isUuid,
	snowflake,
} from '../document.js';
import type {
	DocumentNode,
	DocumentPuzzle,
	DocumentRound,
	HuntCommand,
	HuntCommandRequest,
	HuntCommandResult,
	HuntDocument,
	HuntDocumentClient,
	HuntIntegrationClient,
	HuntIntegrationCommand,
	HuntScope,
	HuntSnapshot,
} from '../document.js';
import { projectPuzzlehuntView } from './types.js';
import { diffPuzzlehuntViews } from './changes.js';
import type {
	DiscordPuzzleInfo,
	DiscordRoundInfo,
	IPuzzlehuntModel,
	LoggingChannelIds,
	PuzzlehuntRound,
	PuzzlehuntView,
	PuzzlehuntChangeEvent,
} from './types.js';

export interface PendingHuntChange {
	readonly request: CommandOperation['request'];
	readonly status: 'pending' | 'uncertain';
	readonly error?: Error;
}

export interface HuntModelFailure {
	readonly request?: CommandOperation['request'];
	readonly error: Error;
}

type CommandOperation = {
	optimisticTime: number;
	status: 'pending' | 'uncertain';
	error?: Error;
} & (
	| { type: 'command'; request: HuntCommandRequest }
	| {
			type: 'integration';
			request: {
				readonly commandId: string;
				readonly command: HuntIntegrationCommand;
			};
	  }
);

type Operation =
	| CommandOperation
	| { type: 'refresh'; targetRevision?: number };

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
	private readonly changeListeners = new Set<
		(event: PuzzlehuntChangeEvent) => void
	>();
	private publishedView: PuzzlehuntView;
	private readonly failed: HuntModelFailure[] = [];
	private draining: Promise<void> | undefined;
	private lastDrain: Promise<void> = Promise.resolve();

	constructor(
		private readonly client: HuntDocumentClient,
		snapshot: HuntSnapshot,
		/** Only supply this capability to trusted integration workers. */
		private readonly integrations?: HuntIntegrationClient
	) {
		this.committed = snapshot;
		this.scope = { huntId: snapshot.huntId, guildId: snapshot.guildId };
		this.validateSnapshot(snapshot);
		this.projected = snapshot.document;
		this.publishedView = this.view;
	}

	static async load(
		client: HuntDocumentClient,
		scope: HuntScope,
		integrations?: HuntIntegrationClient
	): Promise<PuzzlehuntModel> {
		const snapshot = await client.read(scope);
		if (
			snapshot.huntId !== scope.huntId ||
			snapshot.guildId !== scope.guildId
		) {
			throw new Error('Puzzlehunt read returned a different scope.');
		}
		return new PuzzlehuntModel(client, snapshot, integrations);
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

	get guildId(): string {
		return this.scope.guildId;
	}

	get loggingChannelIds(): LoggingChannelIds | undefined {
		return this.projected.configuration.loggingChannelIds;
	}

	setLoggingChannelIds(ids: LoggingChannelIds): void {
		this.dispatch({
			type: 'update-configuration',
			configuration: {
				loggingChannelIds: {
					puzzleAdd: snowflake(ids.puzzleAdd),
					puzzleSolve: snowflake(ids.puzzleSolve),
					puzzleStatusUpdate: snowflake(ids.puzzleStatusUpdate),
				},
			},
		});
	}

	get pendingChanges(): readonly PendingHuntChange[] {
		return this.operations
			.filter((op): op is CommandOperation => op.type !== 'refresh')
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
			nodes: [{ id, type: 'round', name, url, parentId: parent?.id }],
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
		this.dispatch({
			type: 'set-property',
			property: 'name',
			nodeId: node.id,
			value: name,
		});
	}

	changeUrl(node: DocumentNode, url: string): void {
		this.dispatch({
			type: 'set-property',
			property: 'url',
			nodeId: node.id,
			value: url,
		});
	}

	move(node: DocumentNode, parent: PuzzlehuntRound): void {
		this.dispatch({ type: 'move', nodeId: node.id, parentId: parent.id });
	}

	solve(id: string, answer: string): DocumentPuzzle {
		this.dispatch({
			type: 'set-property',
			property: 'answer',
			nodeId: id,
			value: answer,
		});
		return this.getPuzzle(id);
	}

	unsolve(id: string): DocumentPuzzle {
		this.dispatch({
			type: 'set-property',
			property: 'answer',
			value: null,
			nodeId: id,
		});
		return this.getPuzzle(id);
	}

	updateStatus(puzzle: DocumentPuzzle, status: string): void {
		this.dispatch({
			type: 'set-property',
			property: 'status',
			nodeId: puzzle.id,
			value: status,
		});
	}

	clearStatus(puzzle: DocumentPuzzle): void {
		this.dispatch({
			type: 'set-property',
			property: 'status',
			nodeId: puzzle.id,
			value: null,
		});
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
		const { channel, role } = discordInfo;
		const indexChannel =
			'indexChannel' in discordInfo
				? discordInfo.indexChannel
				: undefined;
		this.dispatchIntegration(
			{
				type: 'set-property',
				property: 'discord',
				nodeId: node.id,
				value: {
					channelId: snowflake(
						typeof channel === 'string' ? channel : channel.id
					),
					roleId: snowflake(
						typeof role === 'string' ? role : role.id
					),
					...(indexChannel === undefined
						? {}
						: {
								indexChannelId: snowflake(
									typeof indexChannel === 'string'
										? indexChannel
										: indexChannel.id
								),
						  }),
				},
			},
			durableTaskId
		);
	}

	augmentWithGoogleSheet(
		puzzle: DocumentPuzzle,
		sheetId: string,
		durableTaskId?: string
	): void {
		const command: HuntIntegrationCommand = {
			type: 'set-property',
			property: 'sheetId',
			nodeId: puzzle.id,
			value: sheetId,
		};
		if (durableTaskId === undefined) {
			this.dispatch(command);
		} else {
			this.dispatchIntegration(command, durableTaskId);
		}
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	subscribeChanges(
		listener: (event: PuzzlehuntChangeEvent) => void
	): () => void {
		this.changeListeners.add(listener);
		return () => this.changeListeners.delete(listener);
	}

	/** Commands and snapshots supplied to this model must be treated as immutable. */
	dispatch(command: HuntCommand): string {
		return this.enqueue({
			type: 'command',
			request: { commandId: crypto.randomUUID(), command },
			optimisticTime: Date.now(),
			status: 'pending',
		});
	}

	private dispatchIntegration(
		command: HuntIntegrationCommand,
		durableTaskId: string | undefined
	): void {
		if (durableTaskId === undefined || !isUuid(durableTaskId)) {
			throw new HuntCommandError(
				'invalid-command',
				'A durable provisioning task ID is required.'
			);
		}
		if (this.integrations === undefined) {
			throw new HuntCommandError(
				'forbidden',
				'Completing provisioning tasks requires a trusted integration client.'
			);
		}
		this.enqueue({
			type: 'integration',
			request: { commandId: durableTaskId, command },
			optimisticTime: Date.now(),
			status: 'pending',
		});
	}

	private enqueue(operation: CommandOperation): string {
		// Durable results are authoritative; do not project potentially stale task results.
		if (operation.type === 'command') {
			this.projected = applyHuntCommand(
				this.projected,
				operation.request.command,
				operation.optimisticTime
			).document;
		}
		this.operations.push(operation);
		this.start();
		this.publish();
		return operation.request.commandId;
	}

	flush(): Promise<void> {
		const front = this.operations[0];
		if (front && front.type !== 'refresh' && front.status === 'uncertain') {
			return Promise.reject(front.error);
		}
		return this.draining ?? this.lastDrain;
	}

	/** Refreshes share the command pipeline so a read cannot double-project an in-flight add. */
	refresh(targetRevision?: number): Promise<void> {
		if (targetRevision !== undefined) {
			if (!Number.isSafeInteger(targetRevision) || targetRevision < 0) {
				return Promise.reject(new Error('Invalid refresh revision.'));
			}
			if (targetRevision <= this.committed.revision) {
				return Promise.resolve();
			}
		}
		const queued = this.operations.find((op) => op.type === 'refresh');
		if (queued?.type === 'refresh') {
			queued.targetRevision =
				targetRevision === undefined ||
				queued.targetRevision === undefined
					? undefined
					: Math.max(queued.targetRevision, targetRevision);
		} else {
			this.operations.push({ type: 'refresh', targetRevision });
		}
		this.start();
		return this.flush();
	}

	async retryPending(): Promise<void> {
		if (this.draining) {
			// A subscriber can request retry while the failed attempt is still unwinding.
			await Promise.allSettled([this.draining]);
		}
		const front = this.operations[0];
		if (front && front.type !== 'refresh' && front.status === 'uncertain') {
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
			(front.type !== 'refresh' && front.status === 'uncertain')
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
				const target = operation.targetRevision;
				try {
					if (
						target === undefined ||
						target > this.committed.revision
					) {
						this.accept(await this.client.read(this.scope));
						if (
							target !== undefined &&
							this.committed.revision < target
						) {
							throw new Error(
								'Hunt refresh did not reach the notified revision.'
							);
						}
					}
				} catch (error) {
					this.recordFailure(undefined, error, errors);
					this.operations.shift();
					this.rebase(errors);
					this.publish();
					continue;
				}
				if (
					operation.targetRevision === undefined ||
					operation.targetRevision <= this.committed.revision
				) {
					this.operations.shift();
				}
			} else {
				try {
					let result: HuntCommandResult;
					if (operation.type === 'integration') {
						if (this.integrations === undefined) {
							throw new Error(
								'Missing trusted integration client.'
							);
						}
						result = await this.integrations.completeWork(
							this.scope,
							operation.request.commandId,
							operation.request.command
						);
					} else {
						result = await this.client.submit(
							this.scope,
							operation.request
						);
					}
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
			if (operation.type !== 'command') {
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
		request: CommandOperation['request'] | undefined,
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
		validateHuntDocument(snapshot.document);
	}

	private accept(snapshot: HuntSnapshot): void {
		this.validateSnapshot(snapshot);
		if (snapshot.revision >= this.committed.revision) {
			this.committed = snapshot;
		}
	}

	private publish(): void {
		const event = diffPuzzlehuntViews(this.publishedView, this.view);
		this.publishedView = event.after;
		if (event.changes.length > 0) {
			for (const listener of this.changeListeners) {
				listener(event);
			}
		}
		for (const listener of this.listeners) {
			listener();
		}
	}
}

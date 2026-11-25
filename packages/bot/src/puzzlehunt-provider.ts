import {
	IPuzzlehunt,
	IPuzzlehuntSession,
} from '@belle-puzzles/puzzlehunt-model';
import { loadExistingPuzzlehunt } from '@belle-puzzles/puzzlehunt-model/fluid';
import { makeFluidClient } from './fluid/client.js';
import { PuzzlehuntModel } from '@belle-puzzles/puzzlehunt-model/model';
import type {
	HuntDocumentClient,
	HuntScope,
} from '@belle-puzzles/puzzlehunt-model/document';

/**
 * Owns cached models and their backend-specific resources.
 *
 * @remarks
 * Fluid sessions and HTTP `PuzzlehuntModel`s remain distinct: an HTTP model is
 * not an `IPuzzlehuntSession`. HTTP cache keys include backend, guild, and hunt;
 * concurrent initial loads share a promise. Before commands/channel events,
 * settlement and refresh use the model's existing queue, without SSE.
 *
 * Uncertain HTTP writes retain their original command IDs and block later
 * mutations on that model. They are never automatically evicted or reconstructed
 * as new commands. Explicit `retryPostgresPending` retries those retained IDs,
 * including for inactive cached hunts, but cannot resume setup or control external
 * worker retries. The cache is process-local, not a persisted command queue.
 *
 * Closing stops new loads, flushes models, and releases owned Fluid sessions.
 * Settlement failures are surfaced, including retained IDs for uncertain writes;
 * shutdown never automatically retries an uncertain command.
 */
export interface IPuzzlehuntProvider {
	getPuzzlehunt(
		id: string,
		onInitialLoad?: (puzzlehunt: IPuzzlehunt) => void
	): Promise<IPuzzlehunt>;
	getPostgresPuzzlehunt?(scope: HuntScope): Promise<PuzzlehuntModel>;
	retryPostgresPending?(scope: HuntScope): Promise<void>;
	close?(): Promise<void>;
}

export class PendingPostgresWriteError extends Error {
	constructor(scope: HuntScope, model: PuzzlehuntModel, cause: unknown) {
		super(
			`Write settlement is uncertain for hunt ${scope.huntId}. Do not repeat the original mutation. ` +
				`Use /retry_pending hunt_id:${scope.huntId} in the admin channel to retry retained command IDs: ` +
				model.pendingChanges
					.map((change) => change.request.commandId)
					.join(', '),
			{ cause }
		);
	}
}

export async function settlePostgresModel(
	model: PuzzlehuntModel
): Promise<void> {
	try {
		await model.flush();
	} catch (error) {
		if (model.isPending) {
			throw new PendingPostgresWriteError(
				model.committedSnapshot,
				model,
				error
			);
		}
		throw error;
	}
}

// 10 minutes
// TODO: There's nothing stopping a race condition where we close a container while a
// long-running interaction is trying to use it. This probably isn't an issue for now, but could be.
const DEFAULT_TIMEOUT = 1000 * 60 * 10;

class PuzzlehuntProvider implements IPuzzlehuntProvider {
	private closed = false;
	private readonly postgresModels = new Map<
		string,
		Promise<PuzzlehuntModel>
	>();
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
	constructor(
		private readonly timeout: number = DEFAULT_TIMEOUT,
		private readonly documents?: HuntDocumentClient
	) {}

	public async getPostgresPuzzlehunt(
		scope: HuntScope
	): Promise<PuzzlehuntModel> {
		if (this.closed)
			throw new Error('Puzzlehunt provider is shutting down.');
		if (!this.documents) throw new Error('Local PostgreSQL is disabled.');
		const key = `postgres:${scope.guildId}:${scope.huntId}`;
		let loading = this.postgresModels.get(key);
		if (!loading) {
			loading = PuzzlehuntModel.load(this.documents, scope);
			this.postgresModels.set(key, loading);
			loading.catch(() => this.postgresModels.delete(key));
		}
		const model = await loading;
		if (this.closed)
			throw new Error('Puzzlehunt provider is shutting down.');
		if (model.isPending) await settlePostgresModel(model);
		await model.refresh();
		return model;
	}

	public async retryPostgresPending(scope: HuntScope): Promise<void> {
		if (this.closed)
			throw new Error('Puzzlehunt provider is shutting down.');
		const loading = this.postgresModels.get(
			`postgres:${scope.guildId}:${scope.huntId}`
		);
		if (!loading)
			throw new Error(
				'No retained model in this process. Inspect authoritative state; do not repeat uncertain mutations.'
			);
		const model = await loading;
		try {
			await model.retryPending();
		} catch (error) {
			if (model.isPending)
				throw new PendingPostgresWriteError(scope, model, error);
			throw error;
		}
		await model.refresh();
	}

	public async close(): Promise<void> {
		this.closed = true;
		const results = await Promise.allSettled([
			...Array.from(this.postgresModels.values(), async (loading) => {
				await settlePostgresModel(await loading);
			}),
			...Array.from(this.openFiles.values(), async (entry) => {
				clearTimeout(entry.timeoutId);
				entry.unsubscribeLifecycle();
				try {
					await entry.session.puzzlehunt.flush();
				} finally {
					entry.session.close();
				}
			}),
		]);
		this.openFiles.clear();
		const failures = results.filter(
			(result) => result.status === 'rejected'
		);
		if (failures.length)
			throw new AggregateError(
				failures.map((result) => result.reason),
				'Some hunts failed to settle during shutdown.'
			);
		this.postgresModels.clear();
	}

	public async getPuzzlehunt(
		id: string,
		onInitialLoad?: (puzzlehunt: IPuzzlehunt) => void
	): Promise<IPuzzlehunt> {
		if (this.closed)
			throw new Error('Puzzlehunt provider is shutting down.');
		if (!this.openFiles.has(id)) {
			const session = await loadExistingPuzzlehunt(makeFluidClient(), id);
			if (this.closed) {
				session.close();
				throw new Error('Puzzlehunt provider is shutting down.');
			}
			if (this.openFiles.has(id)) {
				// Another interaction may have attempted to load the same file. If this happened,
				// just use the existing file (session/id/puzzlehunt should all be set reasonably accurately
				// if this has happened) and dispose the one we just loaded to avoid memory leak.
				session.close();
				return this.getPuzzlehunt(id, onInitialLoad);
			}
			try {
				onInitialLoad?.(session.puzzlehunt);
			} catch (error) {
				session.close();
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
			void session.puzzlehunt
				.flush()
				.finally(() => session.close())
				.catch((error) => {
					console.error(`Failed to save puzzlehunt ${id}.`, error);
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

export function createPuzzlehuntProvider(
	documents?: HuntDocumentClient
): IPuzzlehuntProvider {
	return new PuzzlehuntProvider(DEFAULT_TIMEOUT, documents);
}

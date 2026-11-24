import type { IPuzzlehuntSession } from '@belle-puzzles/puzzlehunt-model/model';
import { PuzzlehuntModel } from '@belle-puzzles/puzzlehunt-model/model';
import { snowflake } from '@belle-puzzles/puzzlehunt-model/document';
import {
	HttpHuntDocumentClient,
	type PuzzlehuntDescriptor,
	type PostgresHuntDescriptor,
} from '@belle-puzzles/puzzlehunt-model/http';
import { getDiscordToken } from '../../store/auth';
import type { AppStore } from '../../store/store';
import { getLocalHuntServiceUrl } from '../../services/localHuntConfig';

/**
 * Owns one non-live HTTP model without pretending it is a Fluid session.
 *
 * @remarks
 * Loading uses the descriptor's exact guild/hunt scope, never a separate active-hunt
 * lookup. The HTTP client reads the current Redux Discord OAuth token per request;
 * this path neither accesses PostgreSQL directly nor requests Fluid tokens.
 * Model subscriptions observe optimistic and authoritative changes and save status,
 * not remote notifications: no SSE, observer, or document polling is installed.
 *
 * Disposal suspends requests; the owning hook releases subscriptions and guards late
 * loads/callbacks. An unsettled model is retained only in memory for the original
 * account/guild and service origin. Resuming preserves its original scope and queued
 * command IDs even when active-hunt metadata changes. This is not a durable queue.
 */
export interface HttpPuzzlehunt {
	readonly backend: 'postgres';
	descriptor: PostgresHuntDescriptor;
	readonly model: PuzzlehuntModel;
	readonly serviceUrl: string;
	isActive(): boolean;
	resume(isCurrent: () => boolean): void;
	dispose(): void;
}

export type LoadedPuzzlehunt =
	| HttpPuzzlehunt
	| {
			readonly backend: 'fluid';
			descriptor: Extract<PuzzlehuntDescriptor, { backend: 'fluid' }>;
			readonly model: IPuzzlehuntSession['puzzlehunt'];
			readonly session: IPuzzlehuntSession;
			dispose(): void;
	  };

export function huntIdentity(descriptor: PuzzlehuntDescriptor): string {
	return descriptor.backend === 'fluid'
		? `fluid:${descriptor.fluidFileId}`
		: `postgres:${descriptor.guildId}:${descriptor.huntId}`;
}

// Only retain an already-created model on unexpected unmount with unsettled edits.
// Normal route changes are blocked. This is memory-only, not an offline queue.
const retained = new WeakMap<AppStore, Map<string, HttpPuzzlehunt>>();

export function resumePendingPuzzlehunt(
	store: AppStore,
	guildId: string,
	isCurrent: () => boolean
): HttpPuzzlehunt | undefined {
	const key = `${store.getState().auth.aad?.userId}:${guildId}`;
	const previous = retained.get(store)?.get(key);
	if (!previous || !isCurrent()) return undefined;
	if (getLocalHuntServiceUrl() !== previous.serviceUrl) {
		throw new Error(
			'Reopen the original local service to settle retained edits.'
		);
	}
	retained.get(store).delete(key);
	if (!previous.model.isPending) {
		previous.dispose();
		return undefined;
	}
	previous.resume(isCurrent);
	return previous;
}

export async function loadPuzzlehunt(
	descriptor: PuzzlehuntDescriptor,
	store: AppStore,
	isCurrent: () => boolean,
	guildId: string
): Promise<LoadedPuzzlehunt> {
	const owner = store.getState().auth.aad?.userId;
	const retainedKey = `${owner}:${guildId}`;
	const previous = resumePendingPuzzlehunt(store, guildId, isCurrent);
	if (previous) return previous;
	if (descriptor.backend === 'postgres') {
		if (descriptor.guildId !== guildId) {
			throw new Error('Puzzlehunt metadata returned a different guild.');
		}
		const baseUrl = getLocalHuntServiceUrl();
		let active = true;
		let current = isCurrent;
		const assertActive = () => {
			if (
				!active ||
				!current() ||
				store.getState().auth.aad?.userId !== owner
			) {
				throw new Error(
					'This puzzlehunt is no longer open. Reopen it to retry pending edits.'
				);
			}
		};
		const client = new HttpHuntDocumentClient({
			baseUrl,
			getToken: () => {
				assertActive();
				return getDiscordToken(store.getState()) ?? '';
			},
			fetch: (input, init) => {
				assertActive();
				return fetch(input, init);
			},
		});
		const model = await PuzzlehuntModel.load(client, {
			guildId: snowflake(descriptor.guildId),
			huntId: descriptor.huntId,
		});
		const warnBeforeUnload = (event: BeforeUnloadEvent) => {
			if (model.isPending) {
				event.preventDefault();
				event.returnValue = '';
			}
		};
		window.addEventListener('beforeunload', warnBeforeUnload);
		const loaded: HttpPuzzlehunt = {
			backend: 'postgres',
			descriptor,
			model,
			serviceUrl: baseUrl,
			isActive: () =>
				active &&
				current() &&
				store.getState().auth.aad?.userId === owner &&
				Boolean(getDiscordToken(store.getState())),
			resume: (isCurrent) => {
				current = isCurrent;
				active = true;
			},
			dispose: () => {
				active = false;
				if (model.isPending) {
					let models = retained.get(store);
					if (!models) {
						models = new Map();
						retained.set(store, models);
					}
					models.set(retainedKey, loaded);
					console.error(
						'Unsettled puzzlehunt edits retained in this tab. Reopen the hunt to retry; do not reload.'
					);
				} else {
					window.removeEventListener(
						'beforeunload',
						warnBeforeUnload
					);
				}
			},
		};
		return loaded;
	}

	const [{ createClient }, { loadExistingPuzzlehunt }] = await Promise.all([
		import('./connection'),
		import('@belle-puzzles/puzzlehunt-model/fluid'),
	]);
	const authInfo = store.getState().auth.aad;
	const client = await createClient({
		userId: authInfo?.userId,
		userName: authInfo?.userDetails,
	});
	if (!isCurrent()) {
		throw new Error('Puzzlehunt load was abandoned.');
	}
	const session = await loadExistingPuzzlehunt(
		client,
		descriptor.fluidFileId
	);
	return {
		backend: 'fluid',
		descriptor,
		model: session.puzzlehunt,
		session,
		dispose: () => {
			void session.puzzlehunt
				.flush()
				.finally(() => session.close())
				.catch((error) =>
					console.error('Failed to save puzzlehunt.', error)
				);
		},
	};
}

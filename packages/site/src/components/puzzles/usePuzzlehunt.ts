import * as React from 'react';
import { useSelector, useStore } from 'react-redux';
import { useBlocker } from 'react-router-dom';
import type { PuzzlehuntDescriptor } from '@belle-puzzles/puzzlehunt-model/http';
import type { AppStore, RootState } from '../../store/store';
import { getDiscordToken } from '../../store/auth';
import { belleBotApi } from '../../services/belleBotApi';
import {
	huntIdentity,
	loadPuzzlehunt,
	resumePendingPuzzlehunt,
	type LoadedPuzzlehunt,
} from './loadPuzzlehunt';

export function errorMessage(error: unknown): string {
	if (error instanceof AggregateError) {
		return error.errors.map(errorMessage).join(' ');
	}
	if (error instanceof Error) {
		return error.message;
	}
	if (typeof error === 'object' && error !== null) {
		if ('status' in error) {
			const detail =
				'error' in error && typeof error.error === 'string'
					? error.error
					: 'Check your login and local services, then refresh.';
			return `Puzzlehunt request failed (${error.status}). ${detail}`;
		}
		if ('error' in error && typeof error.error === 'string') {
			return error.error;
		}
	}
	return String(error);
}

/**
 * Explicit refresh, selection, and settlement actions for the loaded hunt.
 *
 * @remarks
 * Entry and refresh force a fresh metadata request instead of treating persisted
 * RTK Query data as authoritative. HTTP refresh settles pending writes before
 * reading; an uncertain outcome prevents both refresh and scope replacement.
 * Changed backend/guild/hunt identity requires deliberate reopening, never retargeting
 * a model with queued writes. A resumed model must revalidate metadata before new edits.
 * Fluid retains its live session and five-minute metadata keepalive.
 */
interface HuntControls {
	refresh(): Promise<void>;
	reopen(): Promise<void>;
	retry(): Promise<void>;
}

export function usePuzzlehunt(guildId: string) {
	const store: AppStore = useStore();
	const owner = useSelector((state: RootState) => state.auth.aad?.userId);
	const hasToken = useSelector((state: RootState) =>
		Boolean(getDiscordToken(state))
	);
	const [loaded, setLoaded] = React.useState<LoadedPuzzlehunt>();
	const [selected, setSelected] = React.useState<PuzzlehuntDescriptor>();
	const [error, setError] = React.useState<string>();
	const [busy, setBusy] = React.useState(true);
	const [metadataVerified, setMetadataVerified] = React.useState(false);
	const [controls, setControls] = React.useState<HuntControls>();
	const [, render] = React.useReducer((value: number) => value + 1, 0);
	const current = React.useRef<LoadedPuzzlehunt>();
	const requestedGuild = React.useRef(guildId);
	const openedGuild = React.useRef<string>();
	requestedGuild.current = guildId;

	const blocker = useBlocker(
		() =>
			current.current?.backend === 'postgres' &&
			current.current.model.isPending
	);

	// TODO: use react async util to avoid isActive kludgery
	React.useEffect(() => {
		let isActive = true;
		const isCurrent = () => isActive && requestedGuild.current === guildId;
		let resource: LoadedPuzzlehunt | undefined;
		let unsubscribe: (() => void) | undefined;
		let unsubscribeLifecycle: (() => void) | undefined;
		let polling: ReturnType<typeof setInterval> | undefined;
		let cancelMetadata: (() => void) | undefined;
		let running = false;
		setLoaded(undefined);
		setSelected(undefined);
		setError(undefined);
		setBusy(true);
		setMetadataVerified(false);

		const release = () => {
			unsubscribe?.();
			unsubscribeLifecycle?.();
			clearInterval(polling);
			resource?.dispose();
			resource = undefined;
			current.current = undefined;
		};
		const attach = async (
			descriptor: PuzzlehuntDescriptor,
			retained?: LoadedPuzzlehunt
		) => {
			const next =
				retained ??
				(await loadPuzzlehunt(descriptor, store, isCurrent, guildId));
			if (!isCurrent()) {
				next.dispose();
				return;
			}
			resource = current.current = next;
			openedGuild.current = guildId;
			unsubscribe = next.model.subscribe(() => {
				if (isActive && resource === next) render();
			});
			setLoaded(next);
			setSelected(
				huntIdentity(next.descriptor) === huntIdentity(descriptor)
					? undefined
					: descriptor
			);
			if (next.backend === 'fluid') {
				const updateLifecycle = () => {
					if (!isActive || resource !== next) return;
					const { state } = next.session;
					if (state.status !== 'open') {
						setError(
							state.status === 'failed'
								? state.error.message
								: 'Puzzlehunt session closed.'
						);
						setLoaded(undefined);
						release();
					}
				};
				unsubscribeLifecycle =
					next.session.subscribeLifecycle(updateLifecycle);
				updateLifecycle();
				/* Note: besides allowing puzzlehunt to notice selection changes, this also ensures belle-bot keeps
				   watching the document to sync it for changes. */
				if (resource === next)
					polling = setInterval(() => void refresh(), 1000 * 60 * 5);
			}
		};
		const run = async (operation: () => Promise<void>) => {
			if (!isActive || running) return;
			running = true;
			setBusy(true);
			setError(undefined);
			try {
				await operation();
			} catch (error) {
				if (isActive) setError(errorMessage(error));
			} finally {
				running = false;
				if (isActive) setBusy(false);
			}
		};
		const refresh = (reopen = false) =>
			run(async () => {
				setMetadataVerified(false);
				if (!resource) {
					const retained = resumePendingPuzzlehunt(
						store,
						guildId,
						isCurrent
					);
					if (retained) await attach(retained.descriptor, retained);
				}
				// A read or scope switch must not discard an uncertain command's ID.
				if (
					resource?.backend === 'postgres' &&
					resource.model.isPending
				) {
					await resource.model.flush();
				}
				if (!isCurrent()) return;
				// RTK data survives reloads. Only this forced request's result is authoritative.
				const request = store.dispatch(
					belleBotApi.endpoints.getPuzzlehuntContext.initiate(
						{ guildId },
						{ forceRefetch: true }
					)
				);
				cancelMetadata = () => {
					request.unsubscribe();
					request.abort();
				};
				let descriptor: PuzzlehuntDescriptor;
				try {
					descriptor = await request.unwrap();
				} finally {
					request.unsubscribe();
					cancelMetadata = undefined;
				}
				if (!isCurrent()) return;
				if (
					resource &&
					huntIdentity(resource.descriptor) !==
						huntIdentity(descriptor)
				) {
					setSelected(descriptor);
					if (!reopen) return;
					if (resource.model.isPending) {
						await resource.model.flush();
						if (!isCurrent()) return;
					}
					release();
					setLoaded(undefined);
				}
				if (!resource) {
					await attach(descriptor);
				} else {
					setSelected(undefined);
					// Identity was checked above; keep display metadata fresh without replacing the model.
					if (
						resource.backend === 'postgres' &&
						descriptor.backend === 'postgres'
					) {
						resource.descriptor = descriptor;
						resource.model.clearFailures();
						await resource.model.refresh();
					} else if (
						resource.backend === 'fluid' &&
						descriptor.backend === 'fluid'
					) {
						resource.descriptor = descriptor;
					}
					if (isActive) render();
				}
				if (isActive) setMetadataVerified(true);
			});
		setControls({
			refresh: () => refresh(),
			reopen: () => refresh(true),
			retry: () =>
				run(async () => {
					if (resource?.backend === 'postgres') {
						await resource.model.retryPending();
					}
				}),
		});
		if (owner && hasToken) {
			void refresh();
		} else {
			setError(
				'Sign in before reopening this hunt. Unsettled edits remain in this tab for the original account.'
			);
			setBusy(false);
		}
		return () => {
			isActive = false;
			cancelMetadata?.();
			release();
		};
	}, [guildId, store, owner, hasToken]);

	React.useEffect(() => {
		if (blocker.state === 'blocked' && !loaded?.model.isPending) {
			blocker.reset();
		}
	}, [blocker, loaded?.model.isPending]);

	return {
		loaded: openedGuild.current === guildId ? loaded : undefined,
		selected,
		error,
		busy,
		metadataVerified,
		navigationBlocked: blocker.state === 'blocked',
		refresh: controls?.refresh,
		reopen: controls?.reopen,
		retry: controls?.retry,
		isCurrent: () =>
			loaded !== undefined &&
			loaded === current.current &&
			requestedGuild.current === guildId,
	};
}

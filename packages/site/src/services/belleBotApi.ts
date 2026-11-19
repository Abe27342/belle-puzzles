import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { REHYDRATE } from 'redux-persist';
import { authorizeToDiscord, getDiscordToken } from '../store/auth';
import { createFetchFn } from './createFetch';
import {
	parsePuzzlehuntDescriptor,
	type PuzzlehuntDescriptor,
} from '@belle-puzzles/puzzlehunt-model/http';
import { getLocalHuntServiceUrl } from './localHuntConfig';

export type PuzzlehuntContext = PuzzlehuntDescriptor;

export function parsePuzzlehuntContext(value: unknown): PuzzlehuntContext {
	// Older bots return the Fluid fields without a backend discriminator.
	return parsePuzzlehuntDescriptor(
		typeof value === 'object' && value !== null && !('backend' in value)
			? { ...value, backend: 'fluid' }
			: value
	);
}

const legacyFetch = createFetchFn(authorizeToDiscord);

export const belleBotApi = createApi({
	reducerPath: 'belleBotApi',
	baseQuery: fetchBaseQuery({
		fetchFn: (input, init) => {
			if (import.meta.env.MODE === 'local-postgres') {
				getLocalHuntServiceUrl();
				// Display local auth failures without redirecting away from pending edits.
				return fetch(input, init);
			}
			return legacyFetch(input, init);
		},
		prepareHeaders: (headers, { getState }) => {
			const token = getDiscordToken(getState());
			headers.set('authorization', `Bearer ${token}`);
			return headers;
		},
		baseUrl: import.meta.env.VITE_BELLE_BOT_BASE_URL,
	}),
	endpoints: (builder) => ({
		getPuzzlehuntContext: builder.query<
			PuzzlehuntContext,
			{ guildId: string }
		>({
			async queryFn({ guildId }, _api, _options, baseQuery) {
				const result = await baseQuery({
					url: `/guilds/${encodeURIComponent(guildId)}/puzzlehunt`,
					cache: 'no-store',
					redirect: 'error',
				});
				if (result.error) {
					return { error: result.error };
				}
				try {
					const data = parsePuzzlehuntContext(result.data);
					if (
						data.backend === 'postgres' &&
						data.guildId !== guildId
					) {
						throw new Error(
							'Puzzlehunt metadata returned a different guild.'
						);
					}
					return { data };
				} catch (error) {
					return {
						error: {
							status: 'CUSTOM_ERROR',
							error:
								error instanceof Error
									? error.message
									: String(error),
						},
					};
				}
			},
		}),
	}),
	// See: https://redux-toolkit.js.org/rtk-query/usage/persistence-and-rehydration
	extractRehydrationInfo: (action, { reducerPath }) => {
		if (action.type === REHYDRATE) {
			return action.payload?.[reducerPath];
		}
	},
});

export const { useGetPuzzlehuntContextQuery } = belleBotApi;

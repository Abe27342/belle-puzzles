import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { REHYDRATE } from 'redux-persist';
import { authorizeToDiscord, getDiscordToken } from '../store/auth';
import { createFetchFn } from './createFetch';

export interface PuzzlehuntContext {
	fluidFileId: string;
	googleFolderId: string;
	name: string;
}

declare const BELLE_BOT_BASE_URL: string;

export const belleBotApi = createApi({
	reducerPath: 'belleBotApi',
	baseQuery: fetchBaseQuery({
		fetchFn: createFetchFn(authorizeToDiscord),
		prepareHeaders: (headers, { getState }) => {
			const token = getDiscordToken(getState());
			headers.set('authorization', `Bearer ${token}`);
			return headers;
		},
		baseUrl: BELLE_BOT_BASE_URL,
	}),
	endpoints: (builder) => ({
		getPuzzlehuntContext: builder.query<
			PuzzlehuntContext,
			{ guildId: string }
		>({
			query: ({ guildId }) => `/guilds/${guildId}/puzzlehunt`,
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

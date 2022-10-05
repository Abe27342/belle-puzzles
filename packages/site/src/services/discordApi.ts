import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { REHYDRATE } from 'redux-persist';
import { authorizeToDiscord, getDiscordToken } from '../store/auth';
import { createFetchFn } from './createFetch';

export interface User {
	id: string;
	email: string;
	avatar: string;
	username: string;
}

export interface Guild {
	id: string;
	name: string;
	icon: string;
	owner: boolean;
	permissions: string; // number
	features: string[]; // Probably never relevant.
}

export const discordApi = createApi({
	reducerPath: 'discordApi',
	baseQuery: fetchBaseQuery({
		baseUrl: 'https://discord.com/api/v10',
		prepareHeaders: (headers, { getState }) => {
			const token = getDiscordToken(getState());
			headers.set('authorization', `Bearer ${token}`);
			return headers;
		},
		fetchFn: createFetchFn(authorizeToDiscord),
	}),
	tagTypes: ['user'],
	endpoints: (builder) => ({
		getGuilds: builder.query<Guild[], void>({
			query: () => '/users/@me/guilds',
		}),
		getUser: builder.query<User, void>({
			query: () => '/users/@me',
			providesTags: ['user'],
		}),
	}),
	extractRehydrationInfo: (action, { reducerPath }) => {
		if (action.type === REHYDRATE) {
			return action.payload?.[reducerPath];
		}
	},
});

export const { useGetGuildsQuery, useGetUserQuery } = discordApi;

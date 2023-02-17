import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { REHYDRATE } from 'redux-persist';
// import { setPostRedirectPath } from '../../redirect';
import { createFetchFn } from './createFetch';
import { Guild } from './discordApi';

export const swaApi = createApi({
	reducerPath: 'swaApi',
	baseQuery: fetchBaseQuery({
		fetchFn: createFetchFn(() => {
			// TODO: Enabling this would be nice, but causes infinite redirect with current auth setup
			// setPostRedirectPath(window.location.pathname);
			window.location.href = `${
				window.location.origin
			}/.auth/login/aad?${new URLSearchParams({
				post_login_redirect_uri: '.referrer',
			})}`;
		}),
		baseUrl: '/api',
	}),
	endpoints: (builder) => ({
		getMutualGuilds: builder.query<
			{ mutualGuilds: Guild[] },
			{ guildIds: string[] }
		>({
			query: ({ guildIds }) =>
				`/discord/userId/mutualGuilds?${new URLSearchParams({
					guildIds: guildIds.join(','),
				})}`,
		}),
	}),
	// See: https://redux-toolkit.js.org/rtk-query/usage/persistence-and-rehydration
	extractRehydrationInfo: (action, { reducerPath }) => {
		if (action.type === REHYDRATE) {
			return action.payload?.[reducerPath];
		}
	},
});

export const { useGetMutualGuildsQuery } = swaApi;

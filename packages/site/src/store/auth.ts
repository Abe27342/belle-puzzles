import {
	createAction,
	createAsyncThunk,
	createReducer,
} from '@reduxjs/toolkit';
import type { AppThunkApiConfig, RootState } from './store';
import { AccessContext, OAuth2AuthCodePKCE } from '@bity/oauth2-auth-code-pkce';
import { setPostRedirectPath } from '../components';

export interface ClientPrincipal {
	identityProvider: string;
	userId: string;
	userDetails: string;
	userRoles: string[];
}

export const login = createAction<{
	service: 'discord';
	context: AccessContext;
}>('auth/login');
export const logout = createAction('auth/logout');

export const clientPrincipalReceived = createAction<ClientPrincipal>('aadAuth');

const discordClientId = '1019695303026290698';
const discordOauthApi = 'https://discord.com/api/oauth2';

interface AuthState {
	discord?: AccessContext;
	aad?: ClientPrincipal;
}

export const authReducer = createReducer<AuthState>(
	{ discord: undefined },
	(builder) => {
		builder
			.addCase(login, (state, action) => {
				const { context, service } = action.payload;
				state[service] = context;
			})
			.addCase(logout, (state) => {
				state.discord = undefined;
				state.aad = undefined;
			})
			.addCase(clientPrincipalReceived, (state, action) => {
				state.aad = action.payload;
			});
	}
);

export const getDiscordToken = (state: RootState): string | undefined =>
	state.auth.discord?.token.value;

export const isLoggedInToDiscord = (state: RootState) =>
	state.auth.discord !== undefined;

export const getMicrosoftUser = (
	state: RootState
): ClientPrincipal | undefined => state.auth.aad;

export const isLoggedInToMicrosoft = (state: RootState) =>
	state.auth.aad !== undefined;

export const isLoggedIn = (state: RootState): boolean =>
	isLoggedInToMicrosoft(state) && isLoggedInToDiscord(state);

const client_id = '1019695303026290698';

// https://discord.com/developers/docs/topics/oauth2#shared-resources-oauth2-scopes
const scopes = ['identify', 'guilds'];

// TODO: Review usage of this with service patterns. Probably a better way to integrate it.
const discordOAuth = new OAuth2AuthCodePKCE({
	authorizationUrl: `${discordOauthApi}/authorize`,
	tokenUrl: `${discordOauthApi}/token`,
	clientId: discordClientId,
	redirectUrl: window.location.origin,
	scopes,
	onAccessTokenExpiry: (refreshAccessToken) => {
		return refreshAccessToken();
	},
	onInvalidGrant: () => {},
});

type StringMap<T> = {
	[key: string]: T;
};

const oauthProviders: StringMap<OAuth2AuthCodePKCE> = {
	discord: discordOAuth,
};

const discordAuthorizeApi = 'https://discord.com/oauth2/authorize';

const REDIRECTING_FROM_SERVICE_KEY = 'REDIRECTING_FROM_SERVICE';

export async function authorizeToDiscord(
	postLoginPathname?: string
): Promise<void> {
	setPostRedirectPath(postLoginPathname ?? window.location.pathname);
	window.localStorage.setItem(REDIRECTING_FROM_SERVICE_KEY, 'discord');
	await discordOAuth.fetchAuthorizationCode({ prompt: 'none' });
}

export function createAddBotToServerUrl(): string {
	const params = new URLSearchParams({
		client_id,
		/* This is a bit flag constant derived with discord's application website. If we want more fancy things, we may want to adjust it to
		 * actually do the logic. Right now it has:
		 * - Manage Roles
		 * - Manage Channels
		 * - Read messages/View Channels
		 * - Send Messages
		 * - Create Public Threads
		 * - Create Private Threads
		 * - Send Messages in Threads
		 * - Manage Messages
		 * - Manage Threads
		 * - Read Message History
		 * - Add Reactions
		 * - Use Slash Commands
		 */
		permissions: '397552987216',
		redirect_uri: window.location.origin,
		response_type: 'code',
		scope: ['bot', ...scopes].join(' '),
	});
	return `${discordAuthorizeApi}?${params}`;
}

export async function isReturningFromAuthServer(): Promise<boolean> {
	const service = window.localStorage.getItem(REDIRECTING_FROM_SERVICE_KEY);
	const provider = oauthProviders[service];
	if (!provider) {
		return false;
	}
	return provider.isReturningFromAuthServer();
}

// https://discord.com/oauth2/authorize?client_id=1019695303026290698&permissions=397552987216&redirect_uri=http%3A%2F%2Flocalhost%3A9000&response_type=code&scope=guilds%20bot

export const fetchToken = createAsyncThunk<void, void, AppThunkApiConfig>(
	'auth/getToken',
	async (_, { dispatch, getState }) => {
		const service = window.localStorage.getItem(
			REDIRECTING_FROM_SERVICE_KEY
		) as 'discord';
		const provider = oauthProviders[service];
		if (!service || !provider) {
			console.error(`Unknown cached local storage service: ${service}`);
			return;
		}
		const isReturning = await provider.isReturningFromAuthServer();
		if (!isReturning) {
			console.error(
				'Attempted to fetch token from code in URL but no code present.'
			);
			return;
		}
		window.localStorage.removeItem(REDIRECTING_FROM_SERVICE_KEY);
		let context: AccessContext;
		try {
			context = await oauthProviders[service].getAccessToken();
		} catch (error) {
			console.log(error);
			return; // maybe re-throw here
		}

		dispatch(login({ service, context }));
	}
);

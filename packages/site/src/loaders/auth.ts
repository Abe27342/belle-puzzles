import * as React from 'react';
import { redirect } from 'react-router-dom';
import {
	clientPrincipalReceived,
	fetchToken,
	isLoggedIn,
	isLoggedInToDiscord,
	isLoggedInToMicrosoft,
	isReturningFromAuthServer,
	logout,
} from '../store/auth';
import { store } from '../store/store';

export async function redirectIfAlreadyLoggedIn(): Promise<null> {
	if (isLoggedIn(store.getState())) {
		throw redirect('/');
	}

	return null;
}

export async function fetchLoginInfo(): Promise<null> {
	ensureLoginRedirect();
	await Promise.all([fetchDiscordLoginInfo(), fetchMicrosoftUserInfo()]);
	return null;
}

async function fetchDiscordLoginInfo(): Promise<null> {
	if (isLoggedInToDiscord(store.getState())) {
		return null;
	}

	if (await isReturningFromAuthServer()) {
		await store.dispatch(fetchToken());
	}

	return null;
}

async function fetchMicrosoftUserInfo(): Promise<null> {
	if (isLoggedInToMicrosoft(store.getState())) {
		return null;
	}

	const response = await fetch('/.auth/me');
	const { clientPrincipal } = await response.json();
	if (clientPrincipal) {
		store.dispatch(clientPrincipalReceived(clientPrincipal));
	}

	return null;
}

let tokenExpiryPollInterval = 5 * 60 * 1000;
let tokenExpiryIntervalId;

// This function exists because there's not a clean way to refresh azure static webapps auth tokens.
// See https://github.com/Azure/static-web-apps/issues/761 for more discussion.
// In the meantime, we poll the /.auth/me endpoint to check if the static web app middleware thinks
// the user is still logged in and use that to update the redux store state.
export function ensureLoginRedirect(): void {
	if (!isLoggedInToMicrosoft(store.getState())) {
		// We were polling for auth redirect, but user has logged out.
		if (tokenExpiryIntervalId !== undefined) {
			clearInterval(tokenExpiryIntervalId);
			tokenExpiryIntervalId = undefined;
		}
	} else if (tokenExpiryIntervalId === undefined) {
		const poller = async () => {
			const response = await fetch('/.auth/me');
			const { clientPrincipal } = await response.json();
			if (clientPrincipal) {
				store.dispatch(clientPrincipalReceived(clientPrincipal));
			} else {
				store.dispatch(logout());
			}
		};
		tokenExpiryIntervalId = setInterval(
			() =>
				poller().catch((err) =>
					console.log('Failed to poll AAD login status:', err)
				),
			tokenExpiryPollInterval
		);
	}
}

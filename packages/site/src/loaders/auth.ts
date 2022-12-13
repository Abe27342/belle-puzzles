import * as React from 'react';
import { redirect } from 'react-router-dom';
import {
	clientPrincipalReceived,
	fetchToken,
	isLoggedIn,
	isLoggedInToDiscord,
	isLoggedInToMicrosoft,
	isReturningFromAuthServer,
} from '../store/auth';
import { store } from '../store/store';

export async function redirectIfAlreadyLoggedIn(): Promise<null> {
	if (isLoggedIn(store.getState())) {
		throw redirect('/');
	}

	return null;
}

export async function fetchLoginInfo(): Promise<null> {
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

	const params = new URLSearchParams(window.location.search);
	if (params.has('code') || params.has('state')) {
		params.delete('code');
		params.delete('state');
		throw redirect(`${window.location.pathname}?${params}`);
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

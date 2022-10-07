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

export async function redirectIfAlreadyLoggedIn() {
	if (isLoggedIn(store.getState())) {
		throw redirect('/');
	}
}

export async function fetchLoginInfo(): Promise<void> {
	await Promise.all([fetchDiscordLoginInfo(), fetchMicrosoftUserInfo()]);
}

async function fetchDiscordLoginInfo(): Promise<void> {
	if (isLoggedInToDiscord(store.getState())) {
		return;
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
}

async function fetchMicrosoftUserInfo(): Promise<void> {
	if (isLoggedInToMicrosoft(store.getState())) {
		return;
	}

	const response = await fetch('/.auth/me');
	const { clientPrincipal } = await response.json();
	if (clientPrincipal) {
		store.dispatch(clientPrincipalReceived(clientPrincipal));
	}
}

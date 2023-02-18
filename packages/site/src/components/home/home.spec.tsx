import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Home } from './home';
import userEvent from '@testing-library/user-event';

describe('Home page', () => {
	beforeEach(() => {
		render(<Home />);
	});

	afterEach(() => {
		vi.resetAllMocks();
	});

	it('has a piece of welcome text', async () => {
		expect(
			screen.getByText(/Puzzlehunt Collab Made Easy/i)
		).toBeInTheDocument();
	});

	it('has an install button with a reasonable authorization URL', async () => {
		const hrefChanges: string[] = [];
		delete window.location;
		const origin = 'mock-origin';
		window.location = {
			origin,
			href: '',
		} as any;
		vi.spyOn(window.location, 'href', 'set').mockImplementation((arg) => {
			hrefChanges.push(arg);
		});
		const user = userEvent.setup();
		await user.click(screen.getByText(/Install/i));

		expect(hrefChanges).toHaveLength(1);
		const url = new URL(hrefChanges[0]);
		expect(url).toMatchObject({
			protocol: 'https:',
			host: 'discord.com',
			pathname: '/oauth2/authorize',
		});

		const search = new URLSearchParams(url.search);
		expect(search.get('redirect_uri')).toEqual(origin);
		expect(search.get('client_id')).toEqual(
			import.meta.env.VITE_BELLE_BOT_CLIENT_ID
		);
		const scopes = search.get('scope').split(' ');
		expect(scopes).toContain('bot');
		expect(scopes).toContain('identify');
		expect(scopes).toContain('guilds');
	});
});

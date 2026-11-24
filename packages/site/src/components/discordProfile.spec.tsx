import * as React from 'react';
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { DiscordProfile } from './discordProfile';

vi.mock('../store/hooks', () => ({ useAppSelector: () => true }));
vi.mock('./login', () => ({ usePostLoginPathname: () => '/home' }));
vi.mock('../services/discordApi', () => ({
	useGetUserQuery: () => ({
		isSuccess: true,
		data: { id: 'test-user', avatar: 'test-avatar', username: 'Test user' },
	}),
}));

it('loads public Discord avatars with anonymous CORS under COEP', () => {
	render(<DiscordProfile />);
	expect(screen.getByRole('img')).toHaveAttribute('crossorigin', 'anonymous');
	expect(screen.getByRole('img')).toHaveAttribute(
		'src',
		'https://cdn.discordapp.com/avatars/test-user/test-avatar'
	);
});

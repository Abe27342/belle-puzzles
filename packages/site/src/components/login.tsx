import * as React from 'react';
import './css/login.css';
import { useLocation, useNavigate } from 'react-router';
import { isLoggedIn, isLoggedInToMicrosoft } from '../store/auth';
import { useAppSelector } from '../store/hooks';
import { Button, Card } from '../fast';
import { DiscordProfile } from './discordProfile';
import { useSearchParams } from 'react-router-dom';
import { setPostRedirectPath } from './redirect';

export const Login: React.FC = () => {
	const isLoggedIn = useIsLoggedIn();
	const aadAccess = useAppSelector(isLoggedInToMicrosoft);

	if (isLoggedIn) {
		return null;
	}

	const postLoginPathname = usePostLoginPathname();
	const authenticateToAad = () => {
		setPostRedirectPath(postLoginPathname);
		window.location.pathname = '/.auth/login/aad';
	};
	return (
		<Card id="login">
			<h1>Login</h1>
			<p>
				This website can display a simple view of your active
				puzzlehunts. To get started, please log in to Discord and AAD
				with any Microsoft account.
			</p>
			<DiscordProfile />
			{!aadAccess && (
				<Button onClick={authenticateToAad}>Login to Microsoft</Button>
			)}
		</Card>
	);
};

export function useIsLoggedIn(): boolean {
	return useAppSelector(isLoggedIn);
}

export function usePostLoginPathname(): string {
	const [searchParams] = useSearchParams();
	const location = useLocation();
	return searchParams.get('postLoginPathname') ?? location.pathname;
}

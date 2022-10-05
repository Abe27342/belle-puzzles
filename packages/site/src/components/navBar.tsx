import * as React from 'react';
import { Outlet, useNavigate } from 'react-router';
import { NavLink } from 'react-router-dom';
import { Anchor, Card, Toolbar } from '../fast';
import { useGetUserQuery } from '../services/discordApi';
import { getMicrosoftUser } from '../store/auth';
import { useAppSelector } from '../store/hooks';
import { DiscordProfile } from './discordProfile';

export const NavBar: React.FC = () => {
	return (
		<>
			<header className="header nav-header">
				<li>
					<Card className="nav-bar-card">Belle Puzzles Bot</Card>
				</li>
				<PageNavigation />
				<AccountInfo />
			</header>
			<Outlet />
		</>
	);
};

const AccountInfo: React.FC = () => {
	const currentMicrosoftUser = useAppSelector(getMicrosoftUser);
	// https://techcommunity.microsoft.com/t5/apps-on-azure-blog/adding-user-profiles-to-static-web-apps/ba-p/2855234
	// could be useful for more useful microsoft info
	const msftContent = currentMicrosoftUser
		? `Microsoft user: ${currentMicrosoftUser.userDetails}`
		: 'Not logged in to Microsoft.';

	return (
		<div className="account-info">
			<li className="account-list-item">
				<DiscordProfile />
			</li>
			<li className="account-list-item">
				<Card className="nav-bar-card">{msftContent}</Card>
			</li>
			<li className="account-list-item">
				<Anchor href="/logout">Logout</Anchor>
			</li>
		</div>
	);
};

const PageNavigation: React.FC = () => {
	return (
		<nav>
			<li>
				<Anchor href="/home">Home</Anchor>
			</li>
			<li>
				<Anchor href="/about">About</Anchor>
			</li>
			<li>
				<Anchor href="/servers">Puzzlehunt Viewer</Anchor>
			</li>
			{/* TODO: include github link here */}
		</nav>
	);
};

import { skipToken } from '@reduxjs/toolkit/dist/query';
import * as React from 'react';
import { Button, Card, Skeleton } from '../fast';
import { useGetUserQuery } from '../services/discordApi';
import { authorizeToDiscord, isLoggedInToDiscord } from '../store/auth';
import { useAppSelector } from '../store/hooks';
import { usePostLoginPathname } from './login';

export const DiscordProfile: React.FC = () => {
	const discordAccess = useAppSelector(isLoggedInToDiscord);
	const maybeSkipToken = discordAccess ? undefined : skipToken;
	const {
		data: currentDiscordUser,
		isLoading,
		isSuccess,
		isUninitialized,
	} = useGetUserQuery(maybeSkipToken as any);

	const postLoginPathname = usePostLoginPathname();
	if (!discordAccess && isUninitialized) {
		return (
			<Button onClick={() => authorizeToDiscord(postLoginPathname)}>
				Discord Login
			</Button>
		);
	}

	const loadingSkeleton = (
		<Skeleton>
			{/* TODO: Make this less ugly. Probably should just use a few skeleton components. */}

			<svg id="pattern" width="100" height="36">
				<defs>
					<mask id="mask" x="0" y="0" width="100%" height="100%">
						<rect
							x="0"
							y="0"
							width="100%"
							height="100%"
							fill="#ffffff"
						/>
						<circle cx="25%" cy="50%" r="9" />
						<rect x="50%" y="30%" width="45%" height="40%" />
					</mask>
				</defs>
				<rect
					x="0"
					y="0"
					width="100%"
					height="100%"
					mask="url(#mask)"
					fill="#ffffff"
				/>
			</svg>
		</Skeleton>
	);
	const discordContent = isSuccess ? (
		<div className="discord-account">
			<img
				className="discord-avatar"
				src={`https://cdn.discordapp.com/avatars/${currentDiscordUser.id}/${currentDiscordUser.avatar}`}
			/>
			<span className="discord-username">
				{currentDiscordUser.username}
			</span>
		</div>
	) : isLoading ? (
		loadingSkeleton
	) : (
		'Profile fetch failed.'
	);

	return <Card className="nav-bar-card">{discordContent}</Card>;
};

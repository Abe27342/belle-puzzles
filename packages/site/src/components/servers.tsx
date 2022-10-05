import * as React from 'react';
import {
	Navigate,
	useLocation,
	useNavigate,
	useSearchParams,
} from 'react-router-dom';
import './css/servers.css';
import { createAddBotToServerUrl } from '../store/auth';
import { Button, Card, Combobox, Option, Toolbar } from '../fast';
import { skipToken } from '@reduxjs/toolkit/dist/query';
import { useGetGuildsQuery } from '../services/discordApi';
import { useGetMutualGuildsQuery } from '../services/swaApi';
import { useIsLoggedIn } from './login';

function onAddToNew() {
	window.localStorage.setItem('REDIRECT_PATHNAME', window.location.pathname);
	window.location.href = createAddBotToServerUrl();
}

const pollingInterval = 5 * 1000;
const queryOptions = {
	pollingInterval: 5 * 60 * 1000 /* milliseconds */,
	refetchOnMountOrArgChange: 20 /* seconds */,
};

export const Servers: React.FC = () => {
	const isLoggedIn = useIsLoggedIn();
	const [searchParams] = useSearchParams();

	const {
		data: allGuilds,
		// isLoading: isUserLoadLoading,
		// isSuccess: isUserLoadSuccess,
		// isError: isUserLoadError,
		// error: getUserError,
		refetch: refetchGuilds,
	} = useGetGuildsQuery(isLoggedIn ? undefined : skipToken, queryOptions);

	const guildIds = React.useMemo(() => {
		if (!allGuilds) {
			return undefined;
		}
		const sortedGuildIds = allGuilds.map((guild) => guild.id);
		sortedGuildIds.sort();
		return sortedGuildIds;
	}, [allGuilds]);

	const {
		data: mutualGuildData,
		isLoading,
		isSuccess,
		isError,
		error,
		isUninitialized,
		refetch: refetchMutualGuilds,
	} = useGetMutualGuildsQuery(
		guildIds ? { guildIds } : skipToken,
		queryOptions
	);
	const { mutualGuilds: guilds } = mutualGuildData ?? { mutualGuilds: [] };

	const refetch = () => {
		refetchGuilds();
		refetchMutualGuilds();
	};

	const navigate = useNavigate();
	const onClick = React.useCallback(
		(event: React.MouseEvent) => {
			navigate(`/hunt/${(event.target as any).value}`);
		},
		[navigate]
	);

	const location = useLocation();
	if (!isLoggedIn) {
		searchParams.set('postLoginPathname', location.pathname);
		return <Navigate to={`/login?${searchParams}`} replace />;
	}

	const content = (
		<Combobox>
			{error && ((error as any).message ?? error.toString())}
			{isLoading || isUninitialized ? (
				<div>Loading...</div>
			) : (
				guilds.map(({ id, name }) => (
					<Option key={id} value={id} onClick={onClick}>
						{name}
					</Option>
				))
			)}
		</Combobox>
	);

	return (
		<div id="servers" className="page-body">
			<Card style={{ contain: 'none' }}>
				<h1>Select hunt</h1>
				<div>{content}</div>
				<div>
					...or add Belle to a new server to get started on a new
					puzzle hunt.
				</div>

				<div>
					<Toolbar>
						<Button onClick={onAddToNew}>Create new hunt</Button>
						<Button onClick={refetch}>Refresh server list</Button>
					</Toolbar>
				</div>
			</Card>
		</div>
	);
};
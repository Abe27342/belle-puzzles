import * as React from 'react';
import { Provider } from 'react-redux';
import {
	createBrowserRouter,
	RouterProvider,
	Route,
	createRoutesFromElements,
	redirect,
	Navigate,
	useSearchParams,
} from 'react-router-dom';
import { PersistGate } from 'redux-persist/integration/react';
import { Login, Logout, Puzzles, Servers, NavBar } from './components';
import { About } from './components/about';
import { Home } from './components/home';
import {
	clientPrincipalReceived,
	fetchToken,
	isLoggedIn,
	isLoggedInToDiscord,
	isLoggedInToMicrosoft,
	isReturningFromAuthServer,
} from './store/auth';
import { persistor, store } from './store/store';

async function fetchLoginInfo(): Promise<void> {
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

async function redirectIfAlreadyLoggedIn() {
	if (isLoggedIn(store.getState())) {
		throw redirect('/');
	}
}

const Router: React.FC = () => {
	// Note: 'router' isn't statically defined to avoid calling its loading functions (and thus potentially redirecting)
	// before persisted redux store state is loaded.
	const router = React.useMemo(
		() =>
			createBrowserRouter(
				createRoutesFromElements([
					<Route path="/logout" element={<Logout />} />,
					<Route element={<NavBar />} loader={fetchLoginInfo}>
						<Route path="/home" element={<Home />} />
						<Route path="/about" element={<About />} />
						<Route
							path="/login"
							element={<Login />}
							loader={redirectIfAlreadyLoggedIn}
						/>
						<Route path="/servers" element={<Servers />} />
						<Route path="/hunt/:guildId" element={<Puzzles />} />
						<Route path="*" element={<RootRedirect />} />,
					</Route>,
				])
			),
		[]
	);

	return <RouterProvider router={router} />;
};

const RootRedirect: React.FC = () => {
	const [params] = useSearchParams();
	const pathname = window.localStorage.getItem('REDIRECT_PATHNAME');
	if (pathname) {
		window.localStorage.removeItem('REDIRECT_PATHNAME');
		return <Navigate to={`${pathname}?${params}`} replace />;
	}

	return <Navigate to={`/home?${params}`} replace />;
};

export const App: React.FC = () => {
	return (
		<Provider store={store}>
			<PersistGate loading={null} persistor={persistor}>
				<Router />
			</PersistGate>
		</Provider>
	);
};

// TODO: Error element

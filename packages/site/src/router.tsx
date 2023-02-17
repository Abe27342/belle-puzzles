import * as React from 'react';
import {
	createBrowserRouter,
	RouterProvider,
	Route,
	createRoutesFromElements,
	useRouteError,
} from 'react-router-dom';
import {
	About,
	Home,
	Login,
	Logout,
	Puzzles,
	Servers,
	NavBar,
	RootRedirect,
} from './components';
import { fetchLoginInfo, redirectIfAlreadyLoggedIn } from './loaders';

export const Router: React.FC = () => {
	// Note: 'router' isn't statically defined to avoid calling its loading functions (and thus potentially redirecting)
	// before persisted redux store state is loaded.
	const router = React.useMemo(
		() =>
			createBrowserRouter(
				createRoutesFromElements([
					<Route path="/logout" element={<Logout />} />,
					<Route
						element={<NavBar />}
						loader={fetchLoginInfo}
						errorElement={<ErrorBoundary />}
					>
						<Route path="/home" element={<Home />} />,
						<Route path="/about" element={<About />} />,
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

function ErrorBoundary() {
	let error = useRouteError();
	console.error(error);
	// Uncaught ReferenceError: path is not defined
	return <div>Something went wrong!</div>;
}

// TODO: Error element

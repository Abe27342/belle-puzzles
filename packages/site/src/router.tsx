import * as React from 'react';
import {
	createBrowserRouter,
	RouterProvider,
	Route,
	createRoutesFromElements,
	replace,
} from 'react-router-dom';
import {
	About,
	Home,
	Login,
	LoginGate,
	Logout,
	Puzzles,
	Servers,
	NavBar,
	HandleAuthRedirects,
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
					<Route element={<NavBar />} loader={fetchLoginInfo}>
						<Route element={<HandleAuthRedirects />}>
							<Route path="/home" element={<Home />} />,
							<Route path="/about" element={<About />} />,
							<Route
								path="/login"
								element={<Login />}
								loader={redirectIfAlreadyLoggedIn}
							/>
							<Route
								path="/servers"
								element={
									<LoginGate>
										<Servers />
									</LoginGate>
								}
							/>
							<Route
								path="/hunt/:guildId"
								element={
									<LoginGate>
										<Puzzles />
									</LoginGate>
								}
							/>
							{/* Redirect any unknown routes */}
							<Route
								path="*"
								loader={redirectToHome}
							/>
						</Route>
					</Route>,
				])
			),
		[]
	);

	return <RouterProvider router={router} />;
};

async function redirectToHome() {
	throw replace('/home');
}

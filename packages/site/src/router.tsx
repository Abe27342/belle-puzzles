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
import { SolverPageSkeleton } from './solvers/solverSkeleton';

const SolverRoute = React.lazy(() =>
	import('./solvers/solverPage').then(({ SolverRoute }) => ({
		default: SolverRoute,
	}))
);

const solverPage = (
	<React.Suspense fallback={<SolverPageSkeleton />}>
		<SolverRoute />
	</React.Suspense>
);

export const Router: React.FC = () => {
	// Note: 'router' isn't statically defined to avoid calling its loading functions (and thus potentially redirecting)
	// before persisted redux store state is loaded.
	const router = React.useMemo(
		() =>
			createBrowserRouter(
				createRoutesFromElements([
					<Route path="/logout" element={<Logout />} />,
					<Route element={<NavBar />}>
						<Route path="/solvers" element={solverPage} />
						<Route
							path="/solvers/:puzzleType"
							element={solverPage}
						/>
						<Route loader={fetchLoginInfo}>
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
								<Route path="*" loader={redirectToHome} />
							</Route>
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

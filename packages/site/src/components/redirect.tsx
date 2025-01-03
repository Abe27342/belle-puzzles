import * as React from 'react';
import {
	Navigate,
	Outlet,
	useLocation,
	useNavigate,
	useSearchParams,
} from 'react-router-dom';
import { getPostRedirectPath, setPostRedirectPath } from '../redirect';

// OAuth2 redirect URIs include these but they are not generally useful after consumption.
// Though we consume these at the top-level in a loader, it's easiest to remove them inside a react component
// (setting window.location.search works but triggers extra page reloads)
const paramsToRemove = ['code', 'state', 'guild_id', 'permissions'];
export const HandleAuthRedirects: React.FC = () => {
	const { pathname } = useLocation();
	const [search] = useSearchParams();
	const navigate = useNavigate();
	React.useEffect(() => {
		if (paramsToRemove.some((param) => search.has(param))) {
			for (const param of paramsToRemove) {
				search.delete(param);
			}
		}

		// If we're being redirected back to belle-puzzles from an OAuth2 flow,
		// redirect to the post-login path we stashed in local state (and clear it) if it exists.
		const redirectPath = getPostRedirectPath();
		setPostRedirectPath(null);
		navigate(
			{
				pathname: redirectPath ?? pathname,
				search: `${search}`,
			},
			{ replace: true }
		);
	}, [search, navigate]);
	return <Outlet />;
};

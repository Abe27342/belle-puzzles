import * as React from 'react';
import { Navigate, Outlet, useSearchParams } from 'react-router-dom';
import { getPostRedirectPath, setPostRedirectPath } from '../redirect';

export const RootRedirect: React.FC = () => {
	const [params] = useSearchParams();
	const pathname = getPostRedirectPath();
	if (pathname) {
		setPostRedirectPath(null);
		return <Navigate to={`${pathname}?${params}`} replace />;
	}

	return <Navigate to={`/home?${params}`} replace />;
};

// OAuth2 redirect URIs include these but they are not generally useful after consumption.
// Though we consume these at the top-level in a loader, it's easiest to remove them inside a react component
// (setting window.location.search works but triggers extra page reloads)
const paramsToRemove = ['code', 'state', 'guild_id', 'permissions'];
export const RemoveAuthParams: React.FC = () => {
	const [search, setSearch] = useSearchParams();
	React.useEffect(() => {
		if (paramsToRemove.some((param) => search.has(param))) {
			for (const param of paramsToRemove) {
				search.delete(param);
			}
			setSearch(search);
		}
	}, [search]);
	return <Outlet />;
};

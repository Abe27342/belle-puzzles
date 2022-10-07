import * as React from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';

const redirectKey = 'REDIRECT_PATHNAME';

export const RootRedirect: React.FC = () => {
	const [params] = useSearchParams();
	const pathname = window.localStorage.getItem(redirectKey);
	if (pathname) {
		window.localStorage.removeItem(redirectKey);
		return <Navigate to={`${pathname}?${params}`} replace />;
	}

	return <Navigate to={`/home?${params}`} replace />;
};

/**
 * Sets up the next load of '/' to redirect to `pathname`. This is primarily useful for oauth2
 * flows by forwarding the user to return to whatever page they were on (some auth providers support
 * redirect parameters, but rather than deal with differences it's easier to use this unified mechanism)
 */
export function setPostRedirectPath(pathname: string): void {
	window.localStorage.setItem(redirectKey, pathname);
}

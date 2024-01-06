import * as React from 'react';
import { useLocation, Navigate } from 'react-router';
import { useIsLoggedIn } from './login';
import { useSearchParams } from 'react-router-dom';

export const LoginGate: React.FC<{ children: React.ReactNode }> = ({
	children,
}) => {
	const isLoggedIn = useIsLoggedIn();
	const [searchParams] = useSearchParams();

	const location = useLocation();
	if (!isLoggedIn) {
		searchParams.set('postLoginPathname', location.pathname);
		return <Navigate to={`/login?${searchParams}`} replace />;
	}

	return <>{children}</>;
};

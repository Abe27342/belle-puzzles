import * as React from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
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

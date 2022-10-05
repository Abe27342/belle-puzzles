import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { logout } from '../store/auth';
import { useAppDispatch } from '../store/hooks';
import { persistor } from '../store/store';

export const Logout: React.FC = () => {
	const dispatch = useAppDispatch();
	const navigate = useNavigate();
	React.useEffect(() => {
		dispatch(logout());
		(async () => {
			await persistor.purge();
			window.location.href = '/.auth/logout';
		})();
	}, [dispatch, navigate]);
	return null;
};

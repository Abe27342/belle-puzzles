import * as React from 'react';
import { useAppDispatch } from '../store/hooks';
import { windowSizeChanged } from '../store/windowSize';

export const WindowSizeSynchronizer: React.FC = () => {
	const dispatch = useAppDispatch();
	React.useEffect(() => {
		const onResize = () => {
			const width = window.innerWidth;
			const height = window.innerHeight;
			dispatch(windowSizeChanged({ width, height }));
		};
		window.addEventListener('resize', onResize);
		onResize();
		return () => {
			window.removeEventListener('resize', onResize);
		};
	}, [dispatch]);

	return null;
};

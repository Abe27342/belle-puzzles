import * as React from 'react';
import {
	createSolverClient,
	prepareSolverWorker,
	type PreparedSolverWorker,
} from './client';

export function usePreparedSolverClient(puzzleType: string | undefined) {
	const prepared = React.useRef<PreparedSolverWorker>();
	const stopPreparing = React.useCallback(() => {
		prepared.current?.dispose();
		prepared.current = undefined;
	}, []);
	React.useEffect(() => {
		if (puzzleType) {
			if (!prepared.current) {
				try {
					prepared.current = prepareSolverWorker();
				} catch (error) {
					console.error(error);
				}
			}
		} else {
			stopPreparing();
		}
	}, [puzzleType, stopPreparing]);
	React.useEffect(() => {
		window.addEventListener('pagehide', stopPreparing);
		return () => {
			window.removeEventListener('pagehide', stopPreparing);
			stopPreparing();
		};
	}, [stopPreparing]);
	return React.useCallback<typeof createSolverClient>(
		(type, text, onResponse) => {
			const idle = prepared.current;
			prepared.current = undefined;
			return idle
				? idle.start(type, text, onResponse)
				: createSolverClient(type, text, onResponse);
		},
		[]
	);
}

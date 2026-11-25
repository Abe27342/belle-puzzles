import * as React from 'react';
import { createSolverClient, type SolverClient } from './client';
import { formatSolverError } from './errors';
import {
	initialSolverSession,
	solverSessionReducer,
	type SolverSessionEvent,
} from './solverSession';

export function useSolverSession(
	puzzleType: string,
	createClient = createSolverClient
) {
	const [state, setState] = React.useState(initialSolverSession);
	const currentState = React.useRef(state);
	const dispatch = React.useCallback((event: SolverSessionEvent) => {
		const previous = currentState.current;
		const updated = solverSessionReducer(previous, event);
		currentState.current = updated;
		setState(updated);
		return previous;
	}, []);
	const client = React.useRef<SolverClient>();
	const generation = React.useRef(0);
	const stop = React.useCallback(() => {
		generation.current++;
		client.current?.dispose();
		client.current = undefined;
	}, []);
	const fail = React.useCallback(
		(message: string) => {
			stop();
			dispatch({ type: 'failed', message });
		},
		[stop, dispatch]
	);

	React.useEffect(() => {
		const onPageHide = () => {
			stop();
			dispatch({ type: 'pageHidden' });
		};
		window.addEventListener('pagehide', onPageHide);
		return () => {
			window.removeEventListener('pagehide', onPageHide);
			stop();
		};
	}, [stop, dispatch]);

	const solve = (text: string) => {
		stop();
		const id = generation.current;
		dispatch({ type: 'started' });
		try {
			client.current = createClient(puzzleType, text, (response) => {
				if (generation.current !== id) return;
				switch (response.type) {
					case 'solution': {
						const previous = dispatch({
							type: 'solutionReceived',
							output: response.output,
						});
						if (previous.phase === 'first') client.current!.next();
						break;
					}
					case 'terminal':
						stop();
						dispatch({
							type: 'searchFinished',
							status: response.status,
						});
						break;
					case 'error':
						fail(response.message);
						break;
				}
			});
		} catch (error) {
			fail(formatSolverError(error, 'runtime', puzzleType));
		}
	};
	const cancel = () => {
		stop();
		dispatch({ type: 'cancelled' });
	};
	const reset = () => {
		stop();
		dispatch({ type: 'inputChanged' });
	};
	const next = () => {
		const previous = dispatch({ type: 'nextRequested' });
		if (previous.phase !== 'ready' || previous.cachedSecond !== null)
			return;
		try {
			client.current!.next();
		} catch (error) {
			console.log(error);
			fail(formatSolverError(error, 'solve', puzzleType));
		}
	};
	return {
		state,
		solve,
		next,
		cancel,
		reset,
	};
}

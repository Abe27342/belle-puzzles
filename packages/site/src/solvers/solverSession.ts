export type Uniqueness =
	| 'unchecked'
	| 'checking'
	| 'unique'
	| 'multiple'
	| 'unknown'
	| 'cancelled';

type SettledUniqueness = Exclude<Uniqueness, 'checking'>;

export type SolverSessionState =
	| {
			phase: 'idle';
			solutions: string[];
			uniqueness: SettledUniqueness;
			cancelled: boolean;
			result?: Extract<SolverSessionState, { phase: 'done' }>;
	  }
	| { phase: 'first'; solutions: []; uniqueness: 'unchecked' }
	| { phase: 'uniqueness'; solutions: [string]; uniqueness: 'checking' }
	| {
			phase: 'ready';
			solutions: string[];
			uniqueness: 'multiple';
			cachedSecond: string | null;
	  }
	| { phase: 'next'; solutions: string[]; uniqueness: 'multiple' }
	| {
			phase: 'done';
			solutions: string[];
			uniqueness: SettledUniqueness;
			outcome: 'exhausted' | 'unknown' | 'no-solutions';
	  }
	| {
			phase: 'done';
			solutions: string[];
			uniqueness: SettledUniqueness;
			outcome: 'error';
			error: string;
	  };

export type SolverSessionEvent =
	| { type: 'started' }
	| { type: 'solutionReceived'; output: string }
	| { type: 'nextRequested' }
	| { type: 'searchFinished'; status: 'unsat' | 'unknown' }
	| { type: 'failed'; message: string }
	| { type: 'cancelled' }
	| { type: 'pageHidden' }
	| { type: 'inputChanged' };

export const initialSolverSession: SolverSessionState = {
	phase: 'idle',
	solutions: [],
	uniqueness: 'unchecked',
	cancelled: false,
};

export function isSolving(state: SolverSessionState) {
	return (
		state.phase === 'first' ||
		state.phase === 'uniqueness' ||
		state.phase === 'next'
	);
}

export function canCancel(state: SolverSessionState) {
	return isSolving(state) || state.phase === 'ready';
}

export function solverSessionReducer(
	state: SolverSessionState,
	event: SolverSessionEvent
): SolverSessionState {
	switch (event.type) {
		case 'inputChanged':
			return initialSolverSession;
		case 'started':
			return { phase: 'first', solutions: [], uniqueness: 'unchecked' };
		case 'solutionReceived':
			if (state.phase === 'first') {
				return {
					phase: 'uniqueness',
					solutions: [event.output],
					uniqueness: 'checking',
				};
			}
			if (state.phase === 'uniqueness') {
				return {
					phase: 'ready',
					solutions: state.solutions,
					uniqueness: 'multiple',
					cachedSecond: event.output,
				};
			}
			if (state.phase === 'next') {
				return {
					phase: 'ready',
					solutions: [...state.solutions, event.output],
					uniqueness: 'multiple',
					cachedSecond: null,
				};
			}
			return state;
		case 'nextRequested':
			if (state.phase !== 'ready') return state;
			return state.cachedSecond !== null
				? {
						...state,
						solutions: [...state.solutions, state.cachedSecond],
						cachedSecond: null,
				  }
				: {
						phase: 'next',
						solutions: state.solutions,
						uniqueness: 'multiple',
				  };
		case 'searchFinished':
			if (!isSolving(state)) return state;
			return {
				phase: 'done',
				solutions: state.solutions,
				uniqueness:
					state.uniqueness === 'checking'
						? event.status === 'unsat'
							? 'unique'
							: 'unknown'
						: state.uniqueness,
				outcome:
					event.status === 'unknown'
						? 'unknown'
						: state.solutions.length === 0
						? 'no-solutions'
						: 'exhausted',
			};
		case 'failed':
			return {
				phase: 'done',
				solutions: state.solutions,
				uniqueness:
					state.uniqueness === 'checking'
						? 'unknown'
						: state.uniqueness,
				outcome: 'error',
				error: event.message,
			};
		case 'cancelled':
			if (!canCancel(state)) return state;
			return {
				phase: 'idle',
				solutions: state.solutions,
				uniqueness:
					state.uniqueness === 'checking'
						? 'cancelled'
						: state.uniqueness,
				cancelled: true,
			};
		case 'pageHidden':
			if (state.phase === 'idle') return state;
			return {
				phase: 'idle',
				solutions: state.solutions,
				uniqueness:
					state.uniqueness === 'checking'
						? 'cancelled'
						: state.uniqueness,
				cancelled: false,
				...(state.phase === 'done' ? { result: state } : {}),
			};
	}
}

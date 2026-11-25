import { describe, expect, it } from 'vitest';
import {
	canCancel,
	initialSolverSession,
	isSolving,
	solverSessionReducer,
	type SolverSessionEvent,
} from './solverSession';

function transition(...events: SolverSessionEvent[]) {
	return events.reduce(solverSessionReducer, initialSolverSession);
}

const started = { type: 'started' } as const;
const first = { type: 'solutionReceived', output: 'first' } as const;
const second = { type: 'solutionReceived', output: 'second' } as const;
const next = { type: 'nextRequested' } as const;

describe('solver session transitions', () => {
	it('caches the uniqueness witness and displays it without another search', () => {
		const state = transition(started, first, second);
		expect(state).toEqual({
			phase: 'ready',
			solutions: ['first'],
			uniqueness: 'multiple',
			cachedSecond: 'second',
		});
		const displayed = solverSessionReducer(state, next);
		expect(displayed).toEqual({
			...state,
			solutions: ['first', 'second'],
			cachedSecond: null,
		});
		expect(solverSessionReducer(displayed, next).phase).toBe('next');
	});

	it.each(['unsat', 'unknown'] as const)(
		'handles %s during the uniqueness check',
		(status) => {
			const state = transition(started, first, {
				type: 'searchFinished',
				status,
			});
			expect(state).toMatchObject({
				phase: 'done',
				solutions: ['first'],
				uniqueness: status === 'unsat' ? 'unique' : 'unknown',
			});
			expect(canCancel(state)).toBe(false);
		}
	);

	it('distinguishes no solutions, unknown, and exhausted enumeration', () => {
		expect(
			transition(started, { type: 'searchFinished', status: 'unsat' })
		).toMatchObject({ outcome: 'no-solutions' });
		expect(
			transition(started, { type: 'searchFinished', status: 'unknown' })
		).toMatchObject({ outcome: 'unknown' });
		expect(
			transition(started, first, second, next, next, {
				type: 'searchFinished',
				status: 'unsat',
			})
		).toMatchObject({
			outcome: 'exhausted',
			solutions: ['first', 'second'],
		});
	});

	it('preserves displayed solutions and discards cached ones on cancellation', () => {
		const state = transition(started, first, second, { type: 'cancelled' });
		expect(state).toEqual({
			phase: 'idle',
			solutions: ['first'],
			uniqueness: 'multiple',
			cancelled: true,
		});
		expect(solverSessionReducer(state, second)).toBe(state);
		expect(solverSessionReducer(state, next)).toBe(state);
	});

	it('distinguishes explicit cancellation from page hiding', () => {
		expect(transition(started, first, { type: 'pageHidden' })).toEqual({
			phase: 'idle',
			solutions: ['first'],
			uniqueness: 'cancelled',
			cancelled: false,
		});
	});

	it('resets the session when input changes or a new solve starts', () => {
		expect(transition(started, first, { type: 'inputChanged' })).toBe(
			initialSolverSession
		);
		expect(transition(started, first, started)).toEqual(
			transition(started)
		);
	});

	it('settles an interrupted uniqueness check on failure', () => {
		const state = transition(started, first, {
			type: 'failed',
			message: 'Search failed',
		});
		expect(state).toMatchObject({
			phase: 'done',
			uniqueness: 'unknown',
			outcome: 'error',
			error: 'Search failed',
			solutions: ['first'],
		});
		expect(isSolving(state)).toBe(false);
	});

	it('only accepts solutions and search results while searching', () => {
		expect(transition(first)).toBe(initialSolverSession);
		expect(transition({ type: 'searchFinished', status: 'unsat' })).toBe(
			initialSolverSession
		);
		expect(isSolving(transition(started))).toBe(true);
	});
});

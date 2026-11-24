import * as React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createSolverClient } from './client';
import { SolverPage, SolverRoute } from './solverPage';
import { puzzleTypes } from './catalog';
import type { SolverResponse } from './protocol';

vi.mock('./client', () => ({ createSolverClient: vi.fn() }));

let respond: (response: SolverResponse) => void;
const next = vi.fn();
const dispose = vi.fn();

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(createSolverClient).mockImplementation(
		(_type, _text, callback) => {
			respond = callback;
			return { next, dispose };
		}
	);
});

function start() {
	const view = render(<SolverPage puzzleType="sudoku" />);
	fireEvent.click(screen.getByRole('button', { name: 'Load example' }));
	fireEvent.click(screen.getByRole('button', { name: 'Solve' }));
	return view;
}

function send(response: SolverResponse) {
	act(() => respond(response));
}

describe('solver page', () => {
	it('precomputes only the second solution and renders it only on demand', () => {
		start();
		expect(createSolverClient).toHaveBeenCalledWith(
			'sudoku',
			puzzleTypes.sudoku.example,
			expect.any(Function)
		);
		send({ type: 'solution', output: 'first' });
		expect(screen.getByLabelText('Solution 1 grid')).toHaveTextContent(
			'first'
		);
		expect(next).toHaveBeenCalledTimes(1);
		expect(screen.getByText(/Checking whether/)).toBeInTheDocument();
		send({ type: 'solution', output: 'second' });
		expect(
			screen.getByText('This puzzle has multiple solutions.')
		).toBeInTheDocument();
		expect(
			screen.queryByLabelText('Solution 2 grid')
		).not.toBeInTheDocument();
		expect(next).toHaveBeenCalledTimes(1);
		fireEvent.click(
			screen.getByRole('button', { name: 'Find next solution' })
		);
		expect(screen.getByLabelText('Solution 2 grid')).toHaveTextContent(
			'second'
		);
		expect(next).toHaveBeenCalledTimes(1);
		fireEvent.click(
			screen.getByRole('button', { name: 'Find next solution' })
		);
		expect(next).toHaveBeenCalledTimes(2);
		expect(
			screen.getByRole('button', { name: 'Find next solution' })
		).toBeDisabled();
		send({ type: 'solution', output: 'third' });
		expect(screen.getByLabelText('Solution 3 grid')).toHaveTextContent(
			'third'
		);
		expect(next).toHaveBeenCalledTimes(2);
		fireEvent.click(
			screen.getByRole('button', { name: 'Find next solution' })
		);
		send({ type: 'terminal', status: 'unsat' });
		expect(screen.getByText('No more solutions.')).toBeInTheDocument();
		expect(dispose).toHaveBeenCalledTimes(1);
	});

	it('proves uniqueness by exhausting the second-solution search', () => {
		start();
		send({ type: 'solution', output: 'only' });
		send({ type: 'terminal', status: 'unsat' });
		expect(
			screen.getByText('This solution is unique.')
		).toBeInTheDocument();
		expect(
			screen.getByRole('button', { name: 'Find next solution' })
		).toBeDisabled();
		expect(dispose).toHaveBeenCalledTimes(1);
	});

	it('distinguishes no solutions from unknown', () => {
		start();
		send({ type: 'terminal', status: 'unsat' });
		expect(
			screen.getByText('This puzzle has no solutions.')
		).toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: 'Solve' }));
		send({ type: 'solution', output: 'first' });
		send({ type: 'terminal', status: 'unknown' });
		expect(
			screen.getByText(/could not determine whether/)
		).toBeInTheDocument();
		expect(screen.getByText(/does not prove/)).toBeInTheDocument();
		expect(
			screen.queryByText('This solution is unique.')
		).not.toBeInTheDocument();
	});

	it('cancels the uniqueness probe, preserves output, and ignores stale results', () => {
		start();
		send({ type: 'solution', output: 'first' });
		fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(dispose).toHaveBeenCalledTimes(1);
		expect(
			screen.getByText(/Uniqueness check cancelled/)
		).toBeInTheDocument();
		expect(screen.getByLabelText('Solution 1 grid')).toHaveTextContent(
			'first'
		);
		send({ type: 'solution', output: 'stale' });
		expect(
			screen.queryByLabelText('Solution 2 grid')
		).not.toBeInTheDocument();
		expect(
			screen.getByRole('button', { name: 'Find next solution' })
		).toBeDisabled();
	});

	it('releases the session and clears old output when input changes', () => {
		start();
		send({ type: 'solution', output: 'first' });
		fireEvent.change(screen.getByLabelText('Puzzle text'), {
			target: { value: 'invalid' },
		});
		expect(dispose).toHaveBeenCalledTimes(1);
		expect(
			screen.queryByLabelText('Solution 1 grid')
		).not.toBeInTheDocument();
		send({ type: 'terminal', status: 'unsat' });
		expect(
			screen.queryByText('This solution is unique.')
		).not.toBeInTheDocument();
	});

	it('surfaces parsing and startup errors', () => {
		start();
		send({ type: 'error', message: 'Invalid Sudoku grid size: 1x1' });
		expect(screen.getByRole('alert')).toHaveTextContent(
			'Invalid Sudoku grid size: 1x1'
		);
		expect(dispose).toHaveBeenCalledTimes(1);
		vi.mocked(createSolverClient).mockImplementation(() => {
			throw new Error('SharedArrayBuffer unavailable');
		});
		fireEvent.click(screen.getByRole('button', { name: 'Solve' }));
		expect(screen.getByRole('alert')).toHaveTextContent(
			'SharedArrayBuffer unavailable'
		);
	});

	it.each(['unmount', 'pagehide'])('releases the runtime on %s', (action) => {
		const view = start();
		if (action === 'unmount') view.unmount();
		else act(() => window.dispatchEvent(new Event('pagehide')));
		expect(dispose).toHaveBeenCalledTimes(1);
		if (action === 'pagehide') {
			expect(screen.getByRole('button', { name: 'Solve' })).toBeEnabled();
			expect(
				screen.getByRole('button', { name: 'Find next solution' })
			).toBeDisabled();
		}
	});

	it.each(Object.keys(puzzleTypes))(
		'provides an unauthenticated route for %s',
		(type) => {
			render(
				<MemoryRouter initialEntries={[`/solvers/${type}`]}>
					<Routes>
						<Route
							path="/solvers/:puzzleType"
							element={<SolverRoute />}
						/>
					</Routes>
				</MemoryRouter>
			);
			expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
				'Solver'
			);
			expect(screen.getByLabelText('Puzzle text')).toBeInTheDocument();
			expect(createSolverClient).not.toHaveBeenCalled();
		}
	);

	it('shows an explanation for unknown puzzle types', () => {
		render(
			<MemoryRouter initialEntries={['/solvers/not-a-puzzle']}>
				<Routes>
					<Route
						path="/solvers/:puzzleType"
						element={<SolverRoute />}
					/>
				</Routes>
			</MemoryRouter>
		);
		expect(screen.getByText(/Unknown puzzle type/)).toBeInTheDocument();
	});
});

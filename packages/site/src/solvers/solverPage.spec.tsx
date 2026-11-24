import * as React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createSolverClient, prepareSolverWorker } from './client';
import { SolverNavigation, SolverPage, SolverRoute } from './solverPage';
import { puzzleTypes } from '@belle-puzzles/solver';
import type { SolverResponse } from './protocol';
import { SolverPageSkeleton } from './solverSkeleton';

vi.mock('./client', () => ({
	createSolverClient: vi.fn(),
	prepareSolverWorker: vi.fn(),
}));

let respond: (response: SolverResponse) => void;
const next = vi.fn();
const dispose = vi.fn();

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(prepareSolverWorker).mockImplementation(() => ({
		start: createSolverClient,
		dispose: vi.fn(),
	}));
	vi.mocked(createSolverClient).mockImplementation(
		(_type, _text, callback) => {
			respond = callback;
			return { next, dispose };
		}
	);
});

afterEach(() => vi.restoreAllMocks());

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
	it('uses the pane layout while loading and leaves Solutions empty until a result arrives', () => {
		const placeholder = render(<SolverPageSkeleton />);
		expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true');
		expect(screen.getByRole('status')).toHaveTextContent(
			'Loading solver page'
		);
		expect(
			placeholder.container.querySelector('.solver-input')
		).toBeInTheDocument();
		expect(
			placeholder.container.querySelector('.solver-output')
		).toBeInTheDocument();
		expect(
			screen.getByRole('region', { name: 'Solutions' }).children
		).toHaveLength(1);
		placeholder.unmount();
		const view = start();
		expect(
			view.container.querySelector('.solver-grid-skeleton')
		).not.toBeInTheDocument();
		expect(
			screen.queryByLabelText('Solution 1 grid')
		).not.toBeInTheDocument();
		expect(screen.getByRole('status').firstElementChild).toHaveClass(
			'solver-visually-hidden'
		);
		send({ type: 'solution', output: 'first' });
		expect(
			view.container.querySelector('.solver-grid-skeleton')
		).not.toBeInTheDocument();
		expect(screen.getByLabelText('Solution 1 grid')).toHaveTextContent(
			'first'
		);
	});

	it('offers one next-solution action after all grids and removes it when enumeration is exhausted', () => {
		start();
		send({ type: 'solution', output: 'first' });
		send({ type: 'solution', output: 'second' });
		fireEvent.click(
			screen.getByRole('button', {
				name: 'Find another solution',
			})
		);
		expect(screen.getByLabelText('Solution 2 grid')).toHaveTextContent(
			'second'
		);
		expect(next).toHaveBeenCalledTimes(1);
		expect(
			screen.getAllByRole('button', { name: 'Find another solution' })
		).toHaveLength(1);
		expect(
			screen
				.getByLabelText('Solution 2 grid')
				.compareDocumentPosition(
					screen.getByRole('button', {
						name: 'Find another solution',
					})
				) & Node.DOCUMENT_POSITION_FOLLOWING
		).not.toBe(0);
		fireEvent.click(
			screen.getByRole('button', {
				name: 'Find another solution',
			})
		);
		expect(next).toHaveBeenCalledTimes(2);
		for (const action of screen.getAllByRole('button', {
			name: 'Find another solution',
		})) {
			expect(action).toBeDisabled();
		}
		send({ type: 'terminal', status: 'unsat' });
		expect(screen.getByText('No more solutions.')).toBeInTheDocument();
		expect(
			screen.queryByText('This puzzle has multiple solutions.')
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole('button', { name: 'Find another solution' })
		).not.toBeInTheDocument();
	});

	it('does not report exhaustion when a subsequent search returns unknown', () => {
		start();
		send({ type: 'solution', output: 'first' });
		send({ type: 'solution', output: 'second' });
		fireEvent.click(
			screen.getByRole('button', { name: 'Find next solution' })
		);
		fireEvent.click(
			screen.getByRole('button', { name: 'Find next solution' })
		);
		send({ type: 'terminal', status: 'unknown' });
		expect(screen.getByText(/does not prove/)).toBeInTheDocument();
		expect(
			screen.queryByText('No more solutions.')
		).not.toBeInTheDocument();
		expect(
			screen.getAllByText('This puzzle has multiple solutions.')
		).toHaveLength(1);
		for (const action of screen.getAllByRole('button', {
			name: 'Find another solution',
		})) {
			expect(action).toBeDisabled();
		}
	});

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

	it('keeps progress below existing solutions and preserves selected solution text', () => {
		start();
		send({ type: 'solution', output: 'first' });
		const first = screen.getByLabelText('Solution 1 grid');
		const status = screen.getByRole('status');
		expect(status).toHaveTextContent(
			'Checking whether the solution is unique'
		);
		expect(
			first.compareDocumentPosition(status) &
				Node.DOCUMENT_POSITION_FOLLOWING
		).not.toBe(0);

		const selection = window.getSelection();
		if (!selection) throw new Error('Text selection is unavailable');
		const range = document.createRange();
		range.selectNodeContents(first);
		selection.removeAllRanges();
		selection.addRange(range);

		send({ type: 'solution', output: 'second' });
		fireEvent.click(
			screen.getByRole('button', { name: 'Find next solution' })
		);
		fireEvent.click(
			screen.getByRole('button', { name: 'Find next solution' })
		);
		const second = screen.getByLabelText('Solution 2 grid');
		expect(status).toHaveTextContent('Finding the next solution');
		expect(
			second.compareDocumentPosition(status) &
				Node.DOCUMENT_POSITION_FOLLOWING
		).not.toBe(0);
		expect(screen.getByLabelText('Solution 1 grid')).toBe(first);
		expect(selection.toString()).toBe('first');

		send({ type: 'solution', output: 'third' });
		expect(screen.getByLabelText('Solution 1 grid')).toBe(first);
		expect(selection.toString()).toBe('first');
		selection.removeAllRanges();
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
			screen.getByText(/This puzzle has no solutions\./)
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
			expect(
				screen.getByRole('heading', {
					level: 1,
					name: puzzleTypes[type].name,
				})
			).toBeInTheDocument();
			expect(screen.getByLabelText('Puzzle text')).toBeInTheDocument();
			expect(screen.getByLabelText('Puzzle text')).toHaveAttribute(
				'placeholder',
				`${puzzleTypes[type].example}\n\n(example)`
			);
			expect(screen.getByLabelText('Puzzle text')).toHaveValue('');
			expect(
				screen.getByRole('button', { name: 'Solve' })
			).toBeDisabled();
			expect(
				screen.getByText(
					`${puzzleTypes[type].instructions} Use a dot (".") or single space (" ") for an empty position. Rows must have equal lengths.`
				)
			).toBeInTheDocument();
			expect(
				screen.queryByText(/No login required/)
			).not.toBeInTheDocument();
			expect(prepareSolverWorker).toHaveBeenCalledTimes(1);
			expect(createSolverClient).not.toHaveBeenCalled();
		}
	);

	it('shows login and local-solving information before selecting a puzzle', () => {
		render(
			<MemoryRouter initialEntries={['/solvers']}>
				<Routes>
					<Route path="/solvers" element={<SolverRoute />} />
				</Routes>
			</MemoryRouter>
		);
		expect(
			screen.getByText(
				'No login required. Puzzles are solved locally in your browser.'
			)
		).toBeInTheDocument();
		expect(screen.queryByLabelText('Puzzle text')).not.toBeInTheDocument();
		expect(
			screen.getByRole('heading', { name: 'Solutions', level: 2 })
		).toBeInTheDocument();
		expect(prepareSolverWorker).not.toHaveBeenCalled();
	});

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
		expect(prepareSolverWorker).not.toHaveBeenCalled();
	});

	it('disposes an unused preloaded worker when the page is hidden or unmounted', () => {
		const idle = { start: createSolverClient, dispose: vi.fn() };
		vi.mocked(prepareSolverWorker).mockReturnValueOnce(idle);
		const view = render(
			<MemoryRouter initialEntries={['/solvers/sudoku']}>
				<Routes>
					<Route
						path="/solvers/:puzzleType"
						element={<SolverRoute />}
					/>
				</Routes>
			</MemoryRouter>
		);
		act(() => window.dispatchEvent(new Event('pagehide')));
		expect(idle.dispose).toHaveBeenCalledTimes(1);
		view.unmount();
		expect(idle.dispose).toHaveBeenCalledTimes(1);
	});

	it('separates puzzle selection, text input, and solution status', () => {
		render(
			<MemoryRouter initialEntries={['/solvers/sudoku']}>
				<Routes>
					<Route
						path="/solvers/:puzzleType"
						element={<SolverRoute />}
					/>
				</Routes>
			</MemoryRouter>
		);
		expect(screen.getByRole('complementary')).toContainElement(
			screen.getByLabelText('Search puzzles')
		);
		expect(
			within(
				screen.getByRole('region', { name: 'Sudoku' })
			).getByLabelText('Puzzle text')
		).toBeInTheDocument();
		expect(
			within(screen.getByRole('region', { name: 'Solutions' })).getByRole(
				'status'
			)
		).toHaveTextContent('Enter a puzzle');
	});

	it('lists puzzles alphabetically by name, including search results', () => {
		render(
			<MemoryRouter>
				<SolverNavigation />
			</MemoryRouter>
		);
		const names = () =>
			screen.getAllByRole('link').map((link) => link.textContent);
		expect(names()).toEqual([
			'Cave',
			'Hashi',
			'Masyu',
			'Shingoki',
			'Slitherlink',
			'Sudoku',
		]);
		fireEvent.change(screen.getByLabelText('Search puzzles'), {
			target: { value: 's' },
		});
		expect(names()).toEqual([
			'Hashi',
			'Masyu',
			'Shingoki',
			'Slitherlink',
			'Sudoku',
		]);
	});

	it('searches the expanded menu and keeps the search when collapsing and reopening', () => {
		render(
			<MemoryRouter initialEntries={['/solvers/sudoku']}>
				<Routes>
					<Route
						path="/solvers/:puzzleType"
						element={<SolverRoute />}
					/>
				</Routes>
			</MemoryRouter>
		);
		expect(
			screen.getByRole('button', { name: 'Collapse puzzle menu' })
		).toHaveAttribute('aria-expanded', 'true');
		fireEvent.change(screen.getByLabelText('Search puzzles'), {
			target: { value: '  HASHI  ' },
		});

		expect(screen.getByRole('link', { name: 'Hashi' })).toBeInTheDocument();
		expect(
			screen.queryByRole('link', { name: 'Masyu' })
		).not.toBeInTheDocument();
		fireEvent.click(
			screen.getByRole('button', { name: 'Collapse puzzle menu' })
		);
		expect(
			screen.queryByRole('link', { name: 'Hashi' })
		).not.toBeInTheDocument();
		expect(
			screen.getByRole('button', { name: 'Expand puzzle menu' })
		).toHaveAttribute('aria-expanded', 'false');
		fireEvent.click(
			screen.getByRole('button', { name: 'Expand puzzle menu' })
		);
		expect(screen.getByLabelText('Search puzzles')).toHaveValue(
			'  HASHI  '
		);
		fireEvent.change(screen.getByLabelText('Search puzzles'), {
			target: { value: 'not-a-puzzle' },
		});
		expect(screen.getByText(/No matching puzzles/)).toBeInTheDocument();
	});

	it('uses a mobile popover with focus, Escape, outside-click, and selection dismissal', () => {
		const media = window.matchMedia('(max-width: 640px)');
		vi.spyOn(window, 'matchMedia').mockReturnValue({
			...media,
			matches: true,
		});
		render(
			<MemoryRouter initialEntries={['/solvers/sudoku']}>
				<Routes>
					<Route
						path="/solvers/:puzzleType"
						element={<SolverRoute />}
					/>
				</Routes>
			</MemoryRouter>
		);
		const trigger = screen.getByRole('button', { name: 'Choose puzzle' });
		expect(trigger).toHaveAttribute('aria-expanded', 'false');
		expect(screen.getByLabelText('Search puzzles')).not.toBeVisible();
		fireEvent.click(trigger);
		expect(
			screen.getByRole('dialog', { name: 'Choose a puzzle' })
		).toBeInTheDocument();
		expect(screen.getByLabelText('Search puzzles')).toHaveFocus();
		fireEvent.keyDown(document, { key: 'Escape' });
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
		expect(trigger).toHaveFocus();
		fireEvent.click(trigger);
		fireEvent.pointerDown(document.body);
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
		fireEvent.click(trigger);
		fireEvent.click(screen.getByRole('link', { name: 'Masyu' }));
		expect(
			screen.getByRole('heading', { name: 'Masyu' })
		).toBeInTheDocument();
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
		expect(trigger).toHaveFocus();
	});

	it('closes the mobile popover when keyboard focus moves to the puzzle input', () => {
		const media = window.matchMedia('(max-width: 640px)');
		vi.spyOn(window, 'matchMedia').mockReturnValue({
			...media,
			matches: true,
		});
		render(
			<MemoryRouter>
				<SolverNavigation />
				<input aria-label="Outside input" />
			</MemoryRouter>
		);
		fireEvent.click(screen.getByRole('button', { name: 'Choose puzzle' }));
		fireEvent.blur(screen.getByLabelText('Search puzzles'), {
			relatedTarget: screen.getByLabelText('Outside input'),
		});
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
	});

	it('resizes the columns with the keyboard without clearing the puzzle input', () => {
		render(
			<MemoryRouter initialEntries={['/solvers/sudoku']}>
				<Routes>
					<Route
						path="/solvers/:puzzleType"
						element={<SolverRoute />}
					/>
				</Routes>
			</MemoryRouter>
		);
		fireEvent.change(screen.getByLabelText('Puzzle text'), {
			target: { value: 'unfinished puzzle' },
		});
		const divider = screen.getByRole('separator', {
			name: 'Resize input and solution columns',
		});
		expect(divider).toHaveAttribute('aria-valuenow', '50');
		fireEvent.keyDown(divider, { key: 'ArrowRight' });
		expect(divider).toHaveAttribute('aria-valuenow', '55');
		expect(
			screen
				.getByRole('main')
				.style.getPropertyValue('--solver-input-share')
		).toBe('55fr');
		fireEvent.keyDown(divider, { key: 'End' });
		fireEvent.keyDown(divider, { key: 'ArrowRight' });
		expect(divider).toHaveAttribute('aria-valuenow', '75');
		fireEvent.keyDown(divider, { key: 'Home' });
		fireEvent.keyDown(divider, { key: 'ArrowLeft' });
		expect(divider).toHaveAttribute('aria-valuenow', '25');
		expect(screen.getByLabelText('Puzzle text')).toHaveValue(
			'unfinished puzzle'
		);
		expect(createSolverClient).not.toHaveBeenCalled();
	});

	it('keeps an active solver session when the divider moves', () => {
		render(
			<MemoryRouter initialEntries={['/solvers/sudoku']}>
				<Routes>
					<Route
						path="/solvers/:puzzleType"
						element={<SolverRoute />}
					/>
				</Routes>
			</MemoryRouter>
		);
		fireEvent.click(screen.getByRole('button', { name: 'Load example' }));
		fireEvent.click(screen.getByRole('button', { name: 'Solve' }));
		fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowLeft' });
		expect(createSolverClient).toHaveBeenCalledTimes(1);
		expect(dispose).not.toHaveBeenCalled();
		send({ type: 'solution', output: 'still solving' });
		expect(screen.getByLabelText('Solution 1 grid')).toHaveTextContent(
			'still solving'
		);
		expect(screen.getByLabelText('Puzzle text')).toHaveValue(
			puzzleTypes.sudoku.example
		);
	});
});

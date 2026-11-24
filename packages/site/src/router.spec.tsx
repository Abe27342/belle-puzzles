import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { Router } from './router';
import { fetchLoginInfo } from './loaders';
import { createSolverClient } from './solvers/client';

vi.mock('./loaders', () => ({
	fetchLoginInfo: vi.fn(async () => null),
	redirectIfAlreadyLoggedIn: vi.fn(async () => null),
}));
vi.mock('./solvers/client', () => ({ createSolverClient: vi.fn() }));
vi.mock('./components', async () => {
	const { Link, Outlet } = await import('react-router-dom');
	return {
		NavBar: () => (
			<>
				<Link to="/home">Home</Link>
				<Link to="/solvers">Solvers</Link>
				<Outlet />
			</>
		),
		HandleAuthRedirects: () => <Outlet />,
		Home: () => <h1>Home page</h1>,
		About: () => <h1>About</h1>,
		Login: () => <h1>Login</h1>,
		Logout: () => <h1>Logout</h1>,
		LoginGate: ({ children }: { children: React.ReactNode }) => (
			<>{children}</>
		),
		Puzzles: () => <h1>Puzzles</h1>,
		Servers: () => <h1>Servers</h1>,
	};
});

const dispose = vi.fn();
beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(createSolverClient).mockReturnValue({ next: vi.fn(), dispose });
	window.history.replaceState(null, '', '/solvers/sudoku');
});

it('loads solver routes without running authentication loaders', async () => {
	render(<Router />);
	expect(
		await screen.findByRole('heading', { name: 'Sudoku Solver' })
	).toBeInTheDocument();
	expect(fetchLoginInfo).not.toHaveBeenCalled();
	expect(createSolverClient).not.toHaveBeenCalled();
});

it('changes puzzle types through the SPA and disposes the old session', async () => {
	render(<Router />);
	await screen.findByRole('heading', { name: 'Sudoku Solver' });
	fireEvent.click(screen.getByRole('button', { name: 'Load example' }));
	fireEvent.click(screen.getByRole('button', { name: 'Solve' }));
	fireEvent.click(screen.getByRole('link', { name: 'Masyu' }));
	expect(
		await screen.findByRole('heading', { name: 'Masyu Solver' })
	).toBeInTheDocument();
	expect(dispose).toHaveBeenCalledTimes(1);
	expect(screen.getByLabelText('Puzzle text')).toHaveValue('');
	expect(fetchLoginInfo).not.toHaveBeenCalled();
	expect(window.location.pathname).toBe('/solvers/masyu');
});

it('preserves authentication loading on existing pages and cleans up when leaving a solver', async () => {
	render(<Router />);
	await screen.findByRole('heading', { name: 'Sudoku Solver' });
	fireEvent.click(screen.getByRole('button', { name: 'Load example' }));
	fireEvent.click(screen.getByRole('button', { name: 'Solve' }));
	fireEvent.click(screen.getByRole('link', { name: 'Home' }));
	expect(
		await screen.findByRole('heading', { name: 'Home page' })
	).toBeInTheDocument();
	expect(fetchLoginInfo).toHaveBeenCalledTimes(1);
	expect(dispose).toHaveBeenCalledTimes(1);
	fireEvent.click(screen.getByRole('link', { name: 'Solvers' }));
	expect(
		await screen.findByRole('heading', { name: 'Logic Puzzle Solvers' })
	).toBeInTheDocument();
	expect(fetchLoginInfo).toHaveBeenCalledTimes(1);
});

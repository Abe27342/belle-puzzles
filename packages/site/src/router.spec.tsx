import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { Router } from './router';
import { fetchLoginInfo } from './loaders';
import { createSolverClient, prepareSolverWorker } from './solvers/client';

vi.mock('./loaders', () => ({
	fetchLoginInfo: vi.fn(async () => null),
	redirectIfAlreadyLoggedIn: vi.fn(async () => null),
}));
vi.mock('./solvers/client', () => ({
	createSolverClient: vi.fn(),
	prepareSolverWorker: vi.fn(),
}));
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
	vi.mocked(prepareSolverWorker).mockImplementation(() => ({
		start: createSolverClient,
		dispose: vi.fn(),
	}));
	vi.mocked(createSolverClient).mockReturnValue({ next: vi.fn(), dispose });
	window.history.replaceState(null, '', '/solvers/Sudoku');
});

async function renderSolverRoute() {
	const view = render(<Router />);
	await screen.findByRole('heading', { name: 'Sudoku' });
	// The lazy-loaded heading can appear before the preload effect runs.
	await waitFor(() => {
		expect(prepareSolverWorker).toHaveBeenCalledTimes(1);
	});
	return view;
}

it('loads solver routes without running authentication loaders', async () => {
	await renderSolverRoute();
	expect(fetchLoginInfo).not.toHaveBeenCalled();
	expect(createSolverClient).not.toHaveBeenCalled();
	expect(prepareSolverWorker).toHaveBeenCalledTimes(1);
});

it('reuses an unused preloaded worker across puzzle types and hands it to the first solve', async () => {
	const idle = { start: createSolverClient, dispose: vi.fn() };
	vi.mocked(prepareSolverWorker).mockReturnValueOnce(idle);
	const view = await renderSolverRoute();
	fireEvent.click(screen.getByRole('link', { name: 'Masyu' }));
	await screen.findByRole('heading', { name: 'Masyu' });
	expect(prepareSolverWorker).toHaveBeenCalledTimes(1);
	expect(idle.dispose).not.toHaveBeenCalled();
	expect(createSolverClient).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole('button', { name: 'Load example' }));
	fireEvent.click(screen.getByRole('button', { name: 'Solve' }));
	expect(createSolverClient).toHaveBeenCalledTimes(1);
	expect(prepareSolverWorker).toHaveBeenCalledTimes(1);
	view.unmount();
	expect(dispose).toHaveBeenCalledTimes(1);
	expect(idle.dispose).not.toHaveBeenCalled();
});

it('disposes an unused preloaded worker when leaving solver routes', async () => {
	const idle = { start: createSolverClient, dispose: vi.fn() };
	vi.mocked(prepareSolverWorker).mockReturnValueOnce(idle);
	await renderSolverRoute();
	fireEvent.click(screen.getByRole('link', { name: 'Home' }));
	await screen.findByRole('heading', { name: 'Home page' });
	await waitFor(() => {
		expect(idle.dispose).toHaveBeenCalledTimes(1);
	});
	expect(createSolverClient).not.toHaveBeenCalled();
});

it('changes puzzle types through the SPA and disposes the old session', async () => {
	await renderSolverRoute();
	fireEvent.click(screen.getByRole('button', { name: 'Load example' }));
	fireEvent.click(screen.getByRole('button', { name: 'Solve' }));
	fireEvent.click(screen.getByRole('link', { name: 'Masyu' }));
	expect(
		await screen.findByRole('heading', { name: 'Masyu' })
	).toBeInTheDocument();
	await waitFor(() => {
		expect(dispose).toHaveBeenCalledTimes(1);
	});
	expect(fetchLoginInfo).not.toHaveBeenCalled();
	expect(window.location.pathname).toBe('/solvers/Masyu');
});

it('preserves authentication loading on existing pages and cleans up when leaving a solver', async () => {
	await renderSolverRoute();
	fireEvent.click(screen.getByRole('button', { name: 'Load example' }));
	fireEvent.click(screen.getByRole('button', { name: 'Solve' }));
	fireEvent.click(screen.getByRole('link', { name: 'Home' }));
	expect(
		await screen.findByRole('heading', { name: 'Home page' })
	).toBeInTheDocument();
	expect(fetchLoginInfo).toHaveBeenCalledTimes(1);
	await waitFor(() => {
		expect(dispose).toHaveBeenCalledTimes(1);
	});
	fireEvent.click(screen.getByRole('link', { name: 'Solvers' }));
	expect(
		await screen.findByRole('heading', { name: 'Logic Puzzle Solvers' })
	).toBeInTheDocument();
	expect(fetchLoginInfo).toHaveBeenCalledTimes(1);
});

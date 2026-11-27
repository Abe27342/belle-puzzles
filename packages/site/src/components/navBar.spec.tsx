import * as React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Provider } from 'react-redux';
import { expect, it } from 'vitest';
import { store } from '../store/store';
import { NavBar } from './navBar';

it.each(['/solvers', '/solvers/sudoku', '/home'])(
	'uses the viewport pane layout only for solver routes: %s',
	(path) => {
		const { container } = render(
			<Provider store={store}>
				<MemoryRouter initialEntries={[path]}>
					<Routes>
						<Route element={<NavBar />}>
							<Route
								path="*"
								element={<main>Page content</main>}
							/>
						</Route>
					</Routes>
				</MemoryRouter>
			</Provider>
		);
		expect(container.querySelector('.solver-site-layout') !== null).toBe(
			path.startsWith('/solvers')
		);
		expect(container.querySelector('header')).not.toBeNull();
	}
);

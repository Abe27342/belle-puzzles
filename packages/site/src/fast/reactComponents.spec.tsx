import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { expect, it } from 'vitest';
import { Anchor } from './reactComponents';

function Location() {
	return <output>{useLocation().pathname}</output>;
}

it('navigates to solvers without reloading the document', () => {
	render(
		<MemoryRouter initialEntries={['/home']}>
			<Anchor href="/solvers">Solvers</Anchor>
			<Location />
		</MemoryRouter>
	);
	const defaultAllowed = fireEvent.click(screen.getByText('Solvers'));
	expect(defaultAllowed).toBe(false);
	expect(screen.getByRole('status')).toHaveTextContent('/solvers');
});

import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import {
	createEmptyDoubledResolutionGrid,
	EmptyGridGenerator,
} from './emptyGridGenerator';

it('creates an empty doubled-resolution grid', () => {
	expect(createEmptyDoubledResolutionGrid(2, 1)).toBe('·-·-·\n|#|#|\n·-·-·');
});

it('copies an empty doubled-resolution grid', async () => {
	const writeText = vi.fn().mockResolvedValue(undefined);
	Object.defineProperty(navigator, 'clipboard', {
		configurable: true,
		value: { writeText },
	});
	render(<EmptyGridGenerator />);

	fireEvent.change(screen.getByLabelText('Width'), {
		target: { value: '2' },
	});
	fireEvent.change(screen.getByLabelText('Height'), {
		target: { value: '1' },
	});
	fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

	expect(await screen.findByText('Empty grid copied')).toBeInTheDocument();
	expect(writeText).toHaveBeenCalledWith('·-·-·\n|#|#|\n·-·-·');
});

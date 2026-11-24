import { expect, it } from 'vitest';
import { errorMessage, formatSolverError } from './errors';

it('keeps actionable details from exceptions and cross-realm error objects', () => {
	expect(
		errorMessage(new Error('Grid 1 must have 9 columns in every row'))
	).toBe('Grid 1 must have 9 columns in every row');
	expect(errorMessage({ message: 'Invalid digit at 2,0: "X"' })).toBe(
		'Invalid digit at 2,0: "X"'
	);
	expect(
		errorMessage(
			new ErrorEvent('error', { error: new Error('Failed to fetch') })
		)
	).toBe('Failed to fetch');
});

it.each([
	new Event('error'),
	'[object Event]',
	'Uncaught [object Event]',
	{},
	null,
])('replaces opaque errors with actionable guidance: %s', (error) => {
	const message = formatSolverError(error, 'runtime');
	expect(message).toContain('Reload the page');
	expect(message).not.toContain('[object');
	expect(message).not.toContain('Details:');
});

it('does not recurse indefinitely through cyclic event-shaped errors', () => {
	const error: { error?: unknown } = {};
	error.error = error;
	expect(errorMessage(error)).toBe('');
});

it('identifies parsing failures and points to the input instructions', () => {
	const message = formatSolverError(
		new Error('Expected 2 text grids, received 1'),
		'parse',
		'shingoki'
	);
	expect(message).toContain('Could not parse this Shingoki puzzle');
	expect(message).toContain('Expected 2 text grids, received 1');
	expect(message).toContain('format instructions');
	expect(message).toContain('load an example');
});

it('shows one-based row and column numbers for coordinate-based parse errors', () => {
	expect(
		formatSolverError(
			new Error('Invalid digit at 2,0: "X"'),
			'parse',
			'hashi'
		)
	).toContain('Row 1, column 3.');
});

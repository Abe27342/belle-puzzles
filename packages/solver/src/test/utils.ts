import { expect } from 'vitest';

export function expectEqualSolutionString(actual: string, expected: string) {
	const normalizedActual = actual.trim();
	const normalizedExpected = expected.trim();
	if (normalizedActual !== normalizedExpected) {
		const firstLineDiff = normalizedActual
			.split('\n')
			.findIndex(
				(line, index) => line !== normalizedExpected.split('\n')[index]
			);
		console.error(`First line with difference: ${firstLineDiff + 1}`);
		console.error(
			`Actual:   ${normalizedActual.split('\n')[firstLineDiff]}`
		);
		console.error(
			`Expected: ${normalizedExpected.split('\n')[firstLineDiff]}`
		);

		console.log(`Actual solution:\n${normalizedActual}`);
	}
	expect(normalizedActual).toEqual(normalizedExpected);
}

import { describe, expect, it } from 'vitest';
import { EdgeIndicatorPuzzle } from '../edge-indicator-puzzle';

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

interface PuzzleClass {
	name: string;
	fromText(input: string): EdgeIndicatorPuzzle<unknown, unknown>;
}

export function describeSuiteFromTestData(
	puzzleClass: PuzzleClass,
	testCases: [name: string, input: string][]
) {
	describe(`${puzzleClass.name} solver`, () => {
		for (const [name, input] of testCases) {
			it(`should solve for input: ${name}`, async () => {
				const puzzle = puzzleClass.fromText(input);
				expect(input.trim()).toMatchSnapshot();
				const assignment = await puzzle.solve();
				const solutionString = await puzzle.renderSolution(assignment);
				expect(solutionString.trim()).toMatchSnapshot();
			});
		}
	});
}

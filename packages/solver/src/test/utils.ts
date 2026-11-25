import { describe, expect, it } from 'vitest';
import {
	CartesianGridPuzzle,
	renderCartesianGrid,
} from '../lib/cartesian-grid-puzzle.js';
import { solve } from '../runtime/index.js';

interface PuzzleClass {
	name: string;
	fromText(input: string): CartesianGridPuzzle<unknown>;
}

function expectGridSnapshot(text: string) {
	const content = text.replace(/\r\n?/g, '\n').replace(/^\s*\n|\n\s*$/g, '');
	expect(`\n${content}\n`).toMatchSnapshot();
}

export function describeSuiteFromTestData(
	puzzleClass: PuzzleClass,
	testCases: [name: string, input: string][]
) {
	describe(`${puzzleClass.name} solver`, () => {
		for (const [name, input] of testCases) {
			it(
				`should solve for input: ${name}`,
				{ timeout: 60000 },
				async () => {
					const puzzle = puzzleClass.fromText(input);
					expectGridSnapshot(input);
					const result = await solve(puzzle);
					const solutionString =
						result.status === 'sat'
							? renderCartesianGrid(
									puzzle.grid,
									result.output,
									puzzle.renderOptions
							  )
							: result.status;
					expectGridSnapshot(solutionString);
				}
			);
		}
	});
}

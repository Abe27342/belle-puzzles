import { describe, expect, it } from 'vitest';
import { MasyuPuzzle, renderMasyuSolution } from '../masyu.js';

function expectEqualSolutionString(actual: string, expected: string) {
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

describe('Masyu solver', () => {
	const testCases = [
		[
			'black corners',
			`
B..
...
..B`,
			`
B-·-·
|   | 
· · ·
|   | 
·-·-B`,
		],
		[
			'complex',
			`
B.W...
..W..W
....B.
.B....
......
....B.
`,
			`
B-·-W-· ·-·
|     | | | 
· ·-W-· · W
| |     | | 
· ·-·-·-B ·
|         | 
· B-·-· ·-·
| |   | |   
· · ·-· · ·
| | |   |   
·-· ·-·-B ·
            `,
		],
	];

	// This set of characters renders better in VSCode editor.
	const renderChars = {
		black: 'B',
		white: 'W',
		vertex: '·',
		horizontal: '-',
		vertical: '|',
	};
	for (const [name, input, expected] of testCases) {
		it(`should solve for input: ${name}`, async () => {
			const puzzle = MasyuPuzzle.fromTextGrid(input);
			expectEqualSolutionString(
				await renderMasyuSolution(puzzle, renderChars),
				expected
			);
		});
	}
});

// this is actually a shingoki
// https://puzzling.stackexchange.com/questions/104786/shingoki-an-exploration-of-unicode
// puzzle = MasyuPuzzle.fromTextGrid(`
// ..........B
// ...WBW.....
// B....B.BB..
// ..W..B...W.
// W..B......B
// ..BB.B....B
// .W..B..W...
// ....BBB.W..
// ....W......
// ....B...BBW
// B..........
// `);

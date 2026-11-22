import { describe, it } from 'vitest';
import { CavePuzzle } from '../cave.js';
import { expectEqualSolutionString } from './utils.js';

describe('Cave solver', () => {
	const testCases: [name: string, input: string, expected: string][] = [
		[
			// https://en.wikipedia.org/wiki/Bag_(puzzle)
			'complex 1',
			`
...3
.4..
5.6.
...2
            `,
			`
· ·-·-·-·
  |    3|
· · · ·-·
  |4  |  
·-· · ·-·
|5   6  |
· ·-·-· ·
| |   |2|
·-· · ·-·
`,
		],
	];

	// This set of characters renders better in VSCode editor.
	const renderChars = {
		vertex: '·',
		horizontal: '-',
		vertical: '|',
	};
	for (const [name, input, expected] of testCases) {
		it(`should solve for input: ${name}`, async () => {
			const puzzle = CavePuzzle.fromTextGrid(input, renderChars);
			const assignment = await puzzle.solve();
			expectEqualSolutionString(
				await puzzle.renderSolution(assignment),
				expected
			);
		});
	}
});

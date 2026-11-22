import { describe, it } from 'vitest';
import { MasyuPuzzle } from '../masyu.js';
import { expectEqualSolutionString } from './utils.js';

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
			const puzzle = MasyuPuzzle.fromTextGrid(input, renderChars);
			const assignment = await puzzle.solve();
			expectEqualSolutionString(
				await puzzle.renderSolution(assignment),
				expected
			);
		});
	}
});

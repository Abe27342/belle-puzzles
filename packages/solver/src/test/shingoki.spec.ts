import { describe, it } from 'vitest';
import { ShingokiPuzzle, ShingokiTextGrids } from '../shingoki.js';
import { expectEqualSolutionString } from './utils.js';

describe('Shingoki solver', () => {
	const testCases: [string, ShingokiTextGrids, string][] = [
		[
			// https://puzzling.stackexchange.com/questions/104044/a-shingoki-puzzle
			'complex 1',
			{
				colors: `
.W....
..B...
......
B....W
WB..B.
......
`,
				lengths: `
.3....
..2...
......
6....5
22..2.
......
                `,
			},
			`
·-W-·-· ·-·
|     | | |
· ·-B ·-· ·
| | |     |
·-· ·-·-· ·
        | |
B-·-·-·-· W
|         |
W B-· ·-B ·
| | | | | |
·-· ·-· ·-·
            `,
		],
		[
			// https://puzzling.stackexchange.com/questions/104786/shingoki-an-exploration-of-unicode
			'complex 2',
			{
				colors: `
..........B
...WBW.....
B....B.BB..
..W..B...W.
W..B......B
..BB.B....B
.W..B..W...
....BBB.W..
....W......
....B...BBW
B..........
            `,
				lengths: `
..........5
...232.....
3....3.33..
..4..2...2.
7..2......2
..22.2....2
.4..2..5...
....223.2..
....5......
....3...222
9..........
                `,
			},
			`
·-·-· ·-· · · ·-·-·-B
|   | | |     |     |
· · · W B-W-· · · · ·
|   | |     | |     |
B-· · ·-·-B ·-B B-·-·
  | |     |     |    
·-· W · ·-B · · ·-W-·
|   |   |           |
W ·-· B-· ·-·-· · ·-B
| |   |   |   |   |  
· · B-B · B-· · · ·-B
| | |       | |     |
· W ·-· B-· · W ·-·-·
| |   | | | | | |    
· · · ·-B B-B · W · ·
| |           | |    
· ·-·-·-W-·-· · ·-·-·
|           | |     |
· · ·-·-B · ·-· B-B W
|   |   |       | | |
B-·-· · ·-·-·-·-· ·-·
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
			const puzzle = ShingokiPuzzle.fromTextGrids(input, renderChars);
			const assignment = await puzzle.solve();
			expectEqualSolutionString(
				await puzzle.renderSolution(assignment),
				expected
			);
		});
	}
});

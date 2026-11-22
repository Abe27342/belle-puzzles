import { describe, it } from 'vitest';
import { SlitherlinkPuzzle } from '../slitherlink.js';
import { expectEqualSolutionString } from './utils.js';

describe('Slitherlink solver', () => {
	const testCases: [name: string, input: string, expected: string][] = [
		[
			// https://en.wikipedia.org/wiki/Slitherlink
			'complex 1',
			`
....0.
33..1.
..12..
..20..
.1..11
.2....
            `,
			`
·-·-·-· · · ·
|     |  0   
· ·-· · · ·-·
|3|3| |  1| |
·-· · ·-· · ·
    |1 2| | |
· · · · ·-· ·
    |2 0    |
· · ·-· · · ·
   1  |  1 1|
·-·-·-· ·-· ·
|  2    | | |
·-·-·-·-· ·-·
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
			const puzzle = SlitherlinkPuzzle.fromTextGrid(input, renderChars);
			const assignment = await puzzle.solve();
			expectEqualSolutionString(
				await puzzle.renderSolution(assignment),
				expected
			);
		});
	}
});

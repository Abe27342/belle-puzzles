import { expect, it } from 'vitest';
import { ShakashakaPuzzle } from '../puzzles/shakashaka.js';
import { SolverSession } from '../runtime/index.js';
import { describeSuiteFromTestData } from './utils.js';

describeSuiteFromTestData(ShakashakaPuzzle, [
	[
		// https://en.wikipedia.org/wiki/Shakashaka
		'complex 1',
		`
#....
.....
#1.#.
.....
.....
        `,
	],
	[
		'complex 2',
		`
....#.....
.....2....
2.......#.
..........
.....#...2
..3#......
#...#.....
.......4..
....2.....
2........2
        `,
	],
]);

it('allows only the filled white diamond inside the numbered border', async () => {
	const puzzle = ShakashakaPuzzle.fromText(`
###11###
##2..2##
#2....2#
1......1
1......1
#2....2#
##2..2##
###11###
`);
	const session = new SolverSession(puzzle);
	const result = await session.nextSolution();
	expect(result.status).toBe('sat');
	if (result.status !== 'sat') return;

	// The faux solution adds a diamond of four triangles in the center,
	// leaving the surrounding white region with a hole.
	for (const x of [3, 4]) {
		for (const y of [3, 4]) {
			expect(result.output.faces.get(puzzle.grid.getFace([x, y]))).toBe(
				'□'
			);
		}
	}
	expect((await session.nextSolution()).status).toBe('unsat');
});

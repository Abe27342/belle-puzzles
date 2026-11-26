import { NurikabePuzzle } from '../puzzles/nurikabe.js';
import { describeSuiteFromTestData } from './utils.js';

describeSuiteFromTestData(NurikabePuzzle, [
	[
		// https://en.wikipedia.org/wiki/Nurikabe_(puzzle)
		'complex',
		`
2........2
......2...
.2..7.....
..........
......3.3.
..2....3..
2..4......
..........
.1....2.4.
            `,
	],
]);

import { CavePuzzle } from '../puzzles/cave.js';
import { describeSuiteFromTestData } from './utils.js';

describeSuiteFromTestData(CavePuzzle, [
	[
		// https://en.wikipedia.org/wiki/Bag_(puzzle)
		'complex 1',
		`
...3
.4..
5.6.
...2
`,
	],
]);

import { NumberlinkPuzzle } from '../puzzles/numberlink.js';
import { describeSuiteFromTestData } from './utils.js';

describeSuiteFromTestData(NumberlinkPuzzle, [
	[
		// https://en.wikipedia.org/wiki/Numberlink
		'complex',
		`
...4...
.3..25.
...31..
...5...
.......
..1....
2...4..
        `,
	],
]);

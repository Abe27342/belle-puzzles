import { TatamibariPuzzle } from '../puzzles/tatamibari.js';
import { describeSuiteFromTestData } from './utils.js';

describeSuiteFromTestData(TatamibariPuzzle, [
	[
		// https://madmahoganypuzzles.wordpress.com/2020/11/01/puzzle-16-tatamibari/
		'complex',
		`
-........|
..++++++..
..........
.......-..
......|...
.....|....
.....|....
....|.....
....|.....
|....+.+.-
            `,
	],
]);

import { ShakashakaPuzzle } from '../puzzles/shakashaka.js';
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
]);

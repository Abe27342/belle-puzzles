import { SlitherlinkPuzzle } from '../puzzles/slitherlink.js';
import { describeSuiteFromTestData } from './utils.js';

describeSuiteFromTestData(SlitherlinkPuzzle, [
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
	],
]);

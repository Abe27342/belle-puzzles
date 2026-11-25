import { FillominoPuzzle } from '../puzzles/fillomino.js';
import { expect, it } from 'vitest';
import { solve } from '../runtime/index.js';
import { describeSuiteFromTestData } from './utils.js';

describeSuiteFromTestData(FillominoPuzzle, [
	[
		'simple',
		`
	15.
	.2.
	...
	        `,
	],
	[
		// https://www.gmpuzzles.com/blog/category/regiondivision/fillomino/
		'complex 1',
		`
	........
	44.43.77
	45.57.37
	........
	........
	45.77.37
	65.77.27
	........
	        `,
	],
	[
		'multidigit cells',
		`
. [10] {10} (10) .
.  .    .    .   .
	`,
	],
]);

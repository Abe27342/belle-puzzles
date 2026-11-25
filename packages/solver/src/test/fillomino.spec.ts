import { FillominoPuzzle } from '../puzzles/fillomino.js';
import { describeSuiteFromTestData } from './utils.js';

describeSuiteFromTestData(FillominoPuzzle, [
	// 	[
	// 		'simple',
	// 		`
	// 15.
	// .2.
	// ...
	//         `,
	// 	],
	// 	[
	// 		'simple 2',
	// 		`
	// ........
	// 44.43.77
	// 45.57.37
	// ........
	// ........
	// 45.77.37
	// 65.77.27
	// ........
	//         `,
	// 	],
	[
		'complex 1',
		`
	...3....5
	..83a..5.
	.3...44..
	13.3..2..
	.2..3..2.
	..2..3.13
	..44...3.
	.4..433..
	6....1...
		`,
	],
]);

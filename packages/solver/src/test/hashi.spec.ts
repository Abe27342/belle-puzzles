import { HashiPuzzle } from '../puzzles/hashi.js';
import { describeSuiteFromTestData } from './utils.js';

describeSuiteFromTestData(HashiPuzzle, [
	[
		'simple',
		`
4.4...2
.1.....
2.2..1.
.......
.3...1.
.......
.3....3
`,
	],
]);

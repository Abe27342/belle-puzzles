import { HashiPuzzle } from '../hashi.js';
import { describeSuiteFromTestData } from './utils.js';

describeSuiteFromTestData(HashiPuzzle, [
	[
		'simple',
		`
23.4.2.
......2
11..133
2..8.52
3.3...1
..2..34
3..31.2
`,
	],
]);

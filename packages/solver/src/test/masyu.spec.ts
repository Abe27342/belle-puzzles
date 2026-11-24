import { MasyuPuzzle } from '../puzzles/masyu.js';
import { describeSuiteFromTestData } from './utils.js';

// This set of characters renders better in VSCode editor.
const renderChars = {
	black: 'B',
	white: 'W',
	vertex: '·',
	horizontal: '-',
	vertical: '|',
};

describeSuiteFromTestData(
	{
		name: 'Masyu',
		fromText: (text) => MasyuPuzzle.fromText(text, renderChars),
	},
	[
		[
			'black corners',
			`
B..
...
..B`,
		],
		[
			'complex',
			`
B.W...
..W..W
....B.
.B....
......
....B.
`,
		],
	]
);

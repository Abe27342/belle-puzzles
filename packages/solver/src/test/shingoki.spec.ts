import { ShingokiPuzzle } from '../puzzles/shingoki.js';
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
		name: 'Shingoki',
		fromText: (text) => ShingokiPuzzle.fromText(text, renderChars),
	},
	[
		[
			'simple',
			`
BB
BB

22
22
			`,
		],
		[
			// https://puzzling.stackexchange.com/questions/104044/a-shingoki-puzzle
			'complex 1',
			`
		.W....
		..B...
		......
		B....W
		WB..B.
		......

		.3....
		..2...
		......
		6....5
		22..2.
		......
		`,
		],
		[
			// https://puzzling.stackexchange.com/questions/104786/shingoki-an-exploration-of-unicode
			'complex 2',

			`
..........B
...WBW.....
B....B.BB..
..W..B...W.
W..B......B
..BB.B....B
.W..B..W...
....BBB.W..
....W......
....B...BBW
B..........

..........5
...232.....
3....3.33..
..4..2...2.
7..2......2
..22.2....2
.4..2..5...
....223.2..
....5......
....3...222
9..........`,
		],
	]
);

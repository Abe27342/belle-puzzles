import { RippleEffectPuzzle } from '../puzzles/ripple-effect.js';
import { describeSuiteFromTestData } from './utils.js';

describeSuiteFromTestData(RippleEffectPuzzle, [
	[
		'simple',
		`
AABBBBB
ABCAACC
CBAAACA
ABCBBAA
AACBBCC
ADCCEFG
ADEEEGG

.......
.......
....1..
...2...
..4....
.......
.......

        `,
	],
	[
		// https://en.wikipedia.org/wiki/Ripple_Effect_(puzzle)
		'complex',
		`
AABBAAAAA
ACDBBCBBA
ACCCBCBBB
BBBCAAABA
ACDDAABCC
DCDDBBBCC
DDCCAACCA
BBBBAABAA
AAAABBBAA

........2
.........
.........
.........
....5....
.........
.........
.........
4........
        `,
	],
]);

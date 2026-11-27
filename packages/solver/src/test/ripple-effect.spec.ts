import { RippleEffectPuzzle } from '../puzzles/ripple-effect.js';
import { describeSuiteFromTestData } from './utils.js';

describeSuiteFromTestData(RippleEffectPuzzle, [
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

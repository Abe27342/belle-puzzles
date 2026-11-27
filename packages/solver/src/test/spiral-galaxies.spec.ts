import { SpiralGalaxiesPuzzle } from '../puzzles/spiral-galaxies.js';
import { describeSuiteFromTestData } from './utils.js';

describeSuiteFromTestData(SpiralGalaxiesPuzzle, [
	[
		// https://en.wikipedia.org/wiki/Tentai_Show
		'complex',
		`
·-·-·-·-·-·-·-·-·-·-·
|#o#|#|#|#|#|o|#|#|#|
·-·-·-·-·-·-·-·-·-·-·
|o|#|o|#|#|#|#|#|o|#|
·-·-·-·-·o·-o-·-·-·-·
|#|#|#|#|#|#|#|#|#|#|
·-·-·-·-·-·-·-·-·-·-·
|#|#|#|#|#|#|#|#|#|o|
·-·-·-·-·-·o·-·-·-·-·
|#|o|o|o|#|#|#|#|#|#|
·-·-·-·-·-·-·-o-·-·-·
|#|#|#|#|#|#|#|#|#o#|
·-·-·-·-·-·-·-·-·-·-·
|#|#|#|#|#|#o#|#|#|#|
·-·-·-·-·-·-·-·-·-·-·
|#|#|#|#|#|#|#|#|#|#|
·-o-·-·o·-·-·-o-·-·o·
|#|#|#|#|#|#|#|#|#|#|
·-·-·-·-·-·-·-·-·-·-·
|o|#|o|o|#|o|#|o|o|#|
·-·-·-·-·-·-·-·-·-·-·
		`,
	],
]);

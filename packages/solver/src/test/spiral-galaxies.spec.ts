import { expect, it } from 'vitest';
import { SpiralGalaxiesPuzzle } from '../puzzles/spiral-galaxies.js';

it('parses pearls in all doubled-grid alignments', () => {
	const puzzle = SpiralGalaxiesPuzzle.fromText(`
·-·-·
|o|#|
·-o-·
|#|o|
·-·-·
`);

	expect(puzzle.width).toBe(2);
	expect(puzzle.height).toBe(2);
});

it('rejects an even doubled-grid dimension', () => {
	expect(() =>
		SpiralGalaxiesPuzzle.fromText(`
··--
|#|
·-·
`)
	).toThrow(/width must be odd|height must be odd/);
});

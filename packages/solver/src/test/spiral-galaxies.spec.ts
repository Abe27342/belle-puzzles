import { SpiralGalaxiesPuzzle } from '../puzzles/spiral-galaxies.js';
import { describeSuiteFromTestData } from './utils.js';
import { expect, it } from 'vitest';
import { solve } from '../runtime/index.js';

it('binds pearls to the correct face, edge, and vertex', () => {
	const face = SpiralGalaxiesPuzzle.fromText(`
·-·
|o|
·-·
`);
	expect(
		face.output.faces.get(face.grid.getFace([0, 0]))?.resolve({} as never)
	).toBe('o');

	const horizontalEdge = SpiralGalaxiesPuzzle.fromText(`
·o·
|#|
·-·
`);
	expect(
		horizontalEdge.output.edges
			.get(horizontalEdge.grid.getEdge([0, 0], [1, 0]))
			?.resolve({} as never)
	).toBe('o');

	const verticalEdge = SpiralGalaxiesPuzzle.fromText(`
·-·
o#|
·-·
`);
	expect(
		verticalEdge.output.edges
			.get(verticalEdge.grid.getEdge([0, 0], [0, 1]))
			?.resolve({} as never)
	).toBe('o');

	const vertex = SpiralGalaxiesPuzzle.fromText(`
o-·
|#|
·-·
`);
	expect(
		vertex.output.vertices
			.get(vertex.grid.getVertex([0, 0]))
			?.resolve({} as never)
	).toBe('o');
});

it('renders internal edges only between different face assignments', async () => {
	const puzzle = SpiralGalaxiesPuzzle.fromText(`
·-·
|o|
·-·
|o|
·-·
`);
	const result = await solve(puzzle);
	expect(result.status).toBe('sat');

	const internal = puzzle.grid.getEdge([0, 1], [1, 1]);
	expect(result.output.edges.get(internal)).toBe('-');
	for (const edge of puzzle.grid.edges()) {
		if (edge === internal) continue;
		expect(
			result.output.edges.get(edge),
			`unexpected boundary edge ${edge.toString()}`
		).toBe(' ');
	}
});

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

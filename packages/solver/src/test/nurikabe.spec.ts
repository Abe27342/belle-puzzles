import { NurikabePuzzle } from '../puzzles/nurikabe.js';
import { expect, it } from 'vitest';
import { solve } from '../runtime/index.js';
import { describeSuiteFromTestData } from './utils.js';

it('initializes static output at construction and preserves it when solving', async () => {
	const puzzle = NurikabePuzzle.fromText('2.\n..');
	const output = puzzle.output;
	const clue = puzzle.grid.getVertex([0, 0]);
	const clueBinding = output.vertices.get(clue);
	expect(output.vertices.size).toBe(4);
	expect(output.edges.size).toBe(4);
	expect(output.faces.size).toBe(1);

	const result = await solve(puzzle);
	if (result.status !== 'sat') {
		throw new Error('Expected a satisfiable Nurikabe');
	}
	expect(puzzle.output).toBe(output);
	expect(output.vertices.get(clue)).toBe(clueBinding);
	expect(result.output.vertices.get(clue)).toBe('2');
	expect(new Set(result.output.edges.values())).toEqual(new Set(['']));
	expect(new Set(result.output.faces.values())).toEqual(new Set(['']));
}, 15000);

describeSuiteFromTestData(NurikabePuzzle, [
	[
		// https://en.wikipedia.org/wiki/Nurikabe_(puzzle)
		'complex',
		`
2........2
......2...
.2..7.....
..........
......3.3.
..2....3..
2..4......
..........
.1....2.4.
            `,
	],
]);

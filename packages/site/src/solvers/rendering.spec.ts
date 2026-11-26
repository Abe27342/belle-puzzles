// @vitest-environment node
import { afterAll, expect, it } from 'vitest';
import { puzzleTypes, renderCartesianGrid } from '@belle-puzzles/solver';
import { solve, shutdownSolverRuntime } from '@belle-puzzles/solver/runtime';

afterAll(async () => {
	await shutdownSolverRuntime();
});

it('retains the existing double-vertical Hashi bridge', async () => {
	const puzzle = puzzleTypes.Hashi.parser.fromText('2\n2');
	const result = await solve(puzzle);
	if (result.status !== 'sat')
		throw new Error('Double-bridge fixture is not satisfiable');
	expect(renderCartesianGrid(puzzle.grid, result.output)).toBe('2\n‖\n2\n');
});

it.each(['Masyu', 'Shingoki'])(
	'uses standard pearl and edge characters for %s without overrides',
	async (type) => {
		const definition = puzzleTypes[type];
		const puzzle = definition.parser.fromText(definition.example);
		const result = await solve(puzzle);
		if (result.status !== 'sat') {
			throw new Error('Pearl fixture is not satisfiable');
		}
		const output = renderCartesianGrid(puzzle.grid, result.output);
		for (const character of ['B', 'W', '-', '|']) {
			expect(output).toContain(character);
		}
	}
);

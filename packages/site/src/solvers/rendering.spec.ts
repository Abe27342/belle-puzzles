// @vitest-environment node
import { afterAll, expect, it } from 'vitest';
import {
	defaultCartesianGridRenderOptions,
	puzzleTypes,
	renderCartesianGrid,
} from '@belle-puzzles/solver';
import { solve, shutdownSolverRuntime } from '@belle-puzzles/solver/runtime';
import { solverRenderOptions } from './rendering';

afterAll(async () => {
	await shutdownSolverRuntime();
});

it('retains the existing double-vertical Hashi bridge', async () => {
	const puzzle = puzzleTypes.hashi.parser.fromText(
		'2\n2',
		solverRenderOptions
	);
	const result = await solve(puzzle);
	if (result.status !== 'sat')
		throw new Error('Double-bridge fixture is not satisfiable');
	expect(
		renderCartesianGrid(puzzle.grid, result.output, puzzle.renderOptions)
	).toBe('2\n‖\n2\n');
});

it('does not change shared rendering defaults', () => {
	expect(defaultCartesianGridRenderOptions).toEqual({
		vertex: '·',
		horizontal: '━',
		vertical: '┃',
	});
	const normal = puzzleTypes.masyu.parser.fromText(puzzleTypes.masyu.example);
	expect(normal.renderOptions).toEqual(defaultCartesianGridRenderOptions);
});

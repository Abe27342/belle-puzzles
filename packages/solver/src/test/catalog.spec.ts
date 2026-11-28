import { expect, it, vi } from 'vitest';
import {
	isPuzzleType,
	puzzleTypes,
	registerPuzzle,
	SudokuPuzzle,
} from '../index.js';

vi.mock('z3-solver', () => {
	throw new Error('Importing the puzzle catalog must not load Z3.');
});

it('imports and parses all registered examples without loading the Z3 runtime', () => {
	expect(Object.keys(puzzleTypes).length).toBeGreaterThan(0);
	expect(puzzleTypes.Sudoku).toBeDefined();
	for (const [type, definition] of Object.entries(puzzleTypes)) {
		expect(isPuzzleType(type)).toBe(true);
		expect(definition.name).not.toBe('');
		expect(definition.instructions).not.toBe('');
		const puzzle = definition.parser.fromText(definition.example);
		expect(puzzle.grid.faceWidth).toBeGreaterThan(2);
		expect(puzzle.grid.faceHeight).toBeGreaterThan(2);
	}
	expect(isPuzzleType('missing')).toBe(false);
	expect(isPuzzleType('toString')).toBe(false);
});

it('rejects duplicate puzzle registrations without replacing the parser', () => {
	const sudoku = puzzleTypes.Sudoku;
	expect(() => registerPuzzle(sudoku)).toThrow(
		'Puzzle type "Sudoku" is already registered.'
	);
	expect(puzzleTypes.Sudoku).toBe(sudoku);
});

it('accepts a new puzzle registration without a central catalog edit', () => {
	registerPuzzle({
		name: 'Catalog test',
		instructions: 'Use Sudoku text.',
		example: puzzleTypes.Sudoku.example,
		parser: SudokuPuzzle,
	});
	expect(isPuzzleType('Catalog test')).toBe(true);
	expect(puzzleTypes['Catalog test'].parser).toBe(SudokuPuzzle);
	expect(Object.isFrozen(puzzleTypes['Catalog test'])).toBe(true);
});

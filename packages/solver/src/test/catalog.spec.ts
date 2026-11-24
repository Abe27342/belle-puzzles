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

declare module '../catalog.js' {
	interface PuzzleTypes {
		'catalog-test': typeof SudokuPuzzle;
	}
}

it('imports and parses all registered examples without loading the Z3 runtime', () => {
	expect(Object.keys(puzzleTypes)).toEqual([
		'sudoku',
		'masyu',
		'shingoki',
		'slitherlink',
		'cave',
		'hashi',
	]);
	for (const [type, definition] of Object.entries(puzzleTypes)) {
		expect(isPuzzleType(type)).toBe(true);
		expect(definition.name).not.toBe('');
		expect(definition.instructions).not.toBe('');
		const puzzle = definition.parser.fromText(definition.example);
		expect(puzzle.width).toBeGreaterThan(0);
		expect(puzzle.height).toBeGreaterThan(0);
	}
	expect(isPuzzleType('missing')).toBe(false);
	expect(isPuzzleType('toString')).toBe(false);
});

it('rejects duplicate puzzle registrations without replacing the parser', () => {
	const sudoku = puzzleTypes.sudoku;
	expect(() => registerPuzzle('sudoku', sudoku)).toThrow(
		'Puzzle type "sudoku" is already registered.'
	);
	expect(puzzleTypes.sudoku).toBe(sudoku);
});

it('accepts a new puzzle registration without a central catalog edit', () => {
	registerPuzzle('catalog-test', {
		name: 'Catalog test',
		instructions: 'Use Sudoku text.',
		example: puzzleTypes.sudoku.example,
		parser: SudokuPuzzle,
	});
	expect(isPuzzleType('catalog-test')).toBe(true);
	expect(puzzleTypes['catalog-test'].parser).toBe(SudokuPuzzle);
	expect(Object.isFrozen(puzzleTypes['catalog-test'])).toBe(true);
});

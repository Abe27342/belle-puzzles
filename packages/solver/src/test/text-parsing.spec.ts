import { describe, expect, it } from 'vitest';
import { CavePuzzle } from '../cave.js';
import { MasyuPuzzle } from '../masyu.js';
import { ShingokiPuzzle } from '../shingoki.js';
import { SlitherlinkPuzzle } from '../slitherlink.js';

describe('puzzle text parsing', () => {
	it('uses character dimensions for vertex clues', () => {
		for (const puzzle of [
			MasyuPuzzle.fromText('.b.\r\n..w'),
			ShingokiPuzzle.fromText('.b.\r\n..w\r\n\r\n.2.\r\n..3'),
		]) {
			expect(puzzle.width).toBe(3);
			expect(puzzle.height).toBe(2);
		}
	});

	it('adds one to character dimensions for face clues', () => {
		for (const Puzzle of [CavePuzzle, SlitherlinkPuzzle]) {
			const puzzle = Puzzle.fromText('1..\r\n..2');
			expect(puzzle.width).toBe(4);
			expect(puzzle.height).toBe(3);
		}
	});

	it.each([CavePuzzle, MasyuPuzzle, SlitherlinkPuzzle])(
		'%s rejects extra grids and ragged rows',
		(Puzzle) => {
			expect(() => Puzzle.fromText('..\n\n..')).toThrow(
				'Expected 1 text grids, received 2'
			);
			expect(() => Puzzle.fromText('..\n.')).toThrow(
				'Grid 1 must have 2 columns in every row'
			);
		}
	);

	it.each(['B', 'B\n\n2\n\n3'])(
		'Shingoki requires exactly two grids for %j',
		(text) => {
			expect(() => ShingokiPuzzle.fromText(text)).toThrow(
				'Expected 2 text grids'
			);
		}
	);

	it('Shingoki rejects inconsistent grid dimensions', () => {
		expect(() => ShingokiPuzzle.fromText('B.\n..\n\n2.')).toThrow(
			'Grid 2 must have 2 rows'
		);
	});

	it('Shingoki rejects pearls without lengths and lengths without pearls', () => {
		expect(() => ShingokiPuzzle.fromText('.B\n\n..')).toThrow(
			'Invalid length at 1,0'
		);
		expect(() => ShingokiPuzzle.fromText('..\n\n.2')).toThrow(
			'Grids do not match at 1,0'
		);
	});
});

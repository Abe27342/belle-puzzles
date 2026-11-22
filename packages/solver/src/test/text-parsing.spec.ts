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
			'Grids do not match at 1,0'
		);
		expect(() => ShingokiPuzzle.fromText('..\n\n.2')).toThrow(
			'Grids do not match at 1,0'
		);
	});

	it.each([CavePuzzle, SlitherlinkPuzzle])(
		'%s rejects non-empty non-digit clues',
		(Puzzle) => {
			expect(() => Puzzle.fromText('..\n.X')).toThrow(
				'Invalid digit at 1,1'
			);
		}
	);

	it.each(['5', '6', '7', '8', '9'])(
		'Slitherlink rejects out-of-range clue %s',
		(digit) => {
			expect(() => SlitherlinkPuzzle.fromText(`..${digit}`)).toThrow(
				'Slitherlink clue at 2,0 must be 0-4'
			);
		}
	);

	it('preserves existing valid numeric ranges', () => {
		expect(() => SlitherlinkPuzzle.fromText('01234')).not.toThrow();
		expect(() => CavePuzzle.fromText('0123456789')).not.toThrow();
	});

	it('ignores empty characters in numeric grids', () => {
		for (const Puzzle of [CavePuzzle, SlitherlinkPuzzle]) {
			expect(() => Puzzle.fromText('. .\n.2.')).not.toThrow();
		}
	});

	it('Masyu rejects unknown pearl colors', () => {
		expect(() => MasyuPuzzle.fromText('.X')).toThrow(
			'Invalid pearl color at 1,0'
		);
	});

	it('Shingoki rejects unknown pearl colors with a matching length', () => {
		expect(() => ShingokiPuzzle.fromText('.X\n\n.2')).toThrow(
			'Invalid pearl color at 1,0'
		);
	});

	it('Shingoki rejects mismatched grids before parsing pearl colors', () => {
		expect(() => ShingokiPuzzle.fromText('.X\n\n..')).toThrow(
			'Grids do not match at 1,0'
		);
	});

	it('Shingoki rejects non-digit lengths', () => {
		expect(() => ShingokiPuzzle.fromText('.W\n\n.X')).toThrow(
			'Invalid digit at 1,0'
		);
	});

	it('Shingoki accepts whitespace and dots when both grids are empty at a position', () => {
		expect(() =>
			ShingokiPuzzle.fromText('. .\n.B.\n\n...\n.2.')
		).not.toThrow();
		expect(() =>
			ShingokiPuzzle.fromText('...\n.B.\n\n. .\n.2.')
		).not.toThrow();
	});

	it('Shingoki rejects whitespace paired with a non-empty value in either grid', () => {
		expect(() => ShingokiPuzzle.fromText('.B.\n\n. .')).toThrow(
			'Grids do not match at 1,0'
		);
		expect(() => ShingokiPuzzle.fromText('. .\n\n.2.')).toThrow(
			'Grids do not match at 1,0'
		);
	});
});

import { describe, expect, it } from 'vitest';
import { CavePuzzle } from '../puzzles/cave.js';
import { FillominoPuzzle } from '../puzzles/fillomino.js';
import { MasyuPuzzle } from '../puzzles/masyu.js';
import { ShingokiPuzzle } from '../puzzles/shingoki.js';
import { SlitherlinkPuzzle } from '../puzzles/slitherlink.js';

describe('puzzle text parsing', () => {
	it('Shingoki parses tab-indented color and length grids', () => {
		const puzzle = ShingokiPuzzle.fromText(
			'\n\t\t.W....\n\t\t..B...\n\t\t......\n\t\tB....W\n\t\tWB..B.\n\t\t......\n\n\t\t.3....\n\t\t..2...\n\t\t......\n\t\t6....5\n\t\t22..2.\n\t\t......\n\t\t'
		);
		expect(puzzle.width).toBe(6);
		expect(puzzle.height).toBe(6);
	});

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
				'Invalid number at 1,1'
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

	it('ignores whitespace between cells in numeric grids', () => {
		for (const Puzzle of [CavePuzzle, SlitherlinkPuzzle]) {
			expect(() => Puzzle.fromText('. . .\n. 2 .')).not.toThrow();
		}
	});

	it.each(['[10]', '(10)', '{10}'])(
		'Fillomino accepts a spaced grid with decimal clue %s',
		(clue) => {
			const puzzle = FillominoPuzzle.fromText(
				`...3 .  ...5\n..83${clue}..5.\n.3.. .  44..\n13.3 .  .2..\n.2.. 3  ..2.\n..2.  . 3.13\n..44.   ..3.\n.4..433..\n6....1...`
			);
			expect(puzzle.width).toBe(10);
			expect(puzzle.height).toBe(10);
		}
	);

	it('Cave accepts multi-digit cell clues', () => {
		const puzzle = CavePuzzle.fromText('. [12] .\n. . .');
		expect(puzzle.width).toBe(4);
		expect(puzzle.height).toBe(3);
	});

	it('Shingoki aligns bracketed lengths with single-cell pearl colors', () => {
		const puzzle = ShingokiPuzzle.fromText('. W .\n\n. {12} .');
		expect(puzzle.width).toBe(3);
		expect(puzzle.height).toBe(1);
	});

	it('Slitherlink still checks its clue range for bracketed integers', () => {
		expect(() => SlitherlinkPuzzle.fromText('. [10]')).toThrow(
			'Slitherlink clue at 1,0 must be 0-4'
		);
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
			'Invalid number at 1,0'
		);
	});

	it('Shingoki ignores whitespace independently in both grids', () => {
		expect(() =>
			ShingokiPuzzle.fromText('. . .\n. B .\n\n...\n.2.')
		).not.toThrow();
		expect(() =>
			ShingokiPuzzle.fromText('...\n.B.\n\n. . .\n. 2 .')
		).not.toThrow();
	});

	it('Shingoki rejects dots paired with a non-empty value in either grid', () => {
		expect(() => ShingokiPuzzle.fromText('.B.\n\n. . .')).toThrow(
			'Grids do not match at 1,0'
		);
		expect(() => ShingokiPuzzle.fromText('. . .\n\n.2.')).toThrow(
			'Grids do not match at 1,0'
		);
	});
});

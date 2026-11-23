import { describe, expect, it, vi } from 'vitest';
import {
	isEmptyGridCharacter,
	parseDigit,
	parsePearlColor,
	parseTextGrids,
} from '../text-grid.js';

describe('grid character parsing', () => {
	it.each(['.', ' ', '\t', '\n', '\r'])(
		'recognizes the empty placeholder %j',
		(value) => {
			expect(isEmptyGridCharacter(value)).toBe(true);
		}
	);

	it.each(['0', 'B', '?', '', '  '])(
		'does not treat %j as an empty character',
		(value) => {
			expect(isEmptyGridCharacter(value)).toBe(false);
		}
	);

	it.each(Array.from({ length: 10 }, (_, digit) => digit))(
		'parses digit %i',
		(digit) => {
			expect(parseDigit(String(digit), [2, 3])).toBe(digit);
		}
	);

	it.each(['.', ' ', 'A', '', '12', '1x', '-1', '1.0'])(
		'rejects non-digit %j with its coordinate',
		(value) => {
			expect(() => parseDigit(value, [2, 3])).toThrow(
				'Invalid digit at 2,3'
			);
		}
	);

	it.each([
		['B', 'black'],
		['b', 'black'],
		['W', 'white'],
		['w', 'white'],
	])('parses pearl color %s', (value, color) => {
		expect(parsePearlColor(value, [2, 3])).toBe(color);
	});

	it.each(['.', ' ', '?', '1', '', 'BW'])(
		'rejects invalid pearl color %j with its coordinate',
		(value) => {
			expect(() => parsePearlColor(value, [2, 3])).toThrow(
				'Invalid pearl color at 2,3'
			);
		}
	);
});

describe('parseTextGrids', () => {
	it.each(['\t\t', '    ', '\t  '])(
		'removes common indentation %j without shifting coordinates',
		(indentation) => {
			const visitor = vi.fn();
			expect(
				parseTextGrids(
					`\n${indentation}.W.\n${indentation}B..\n${indentation}\n`,
					visitor
				)
			).toEqual({ width: 3, height: 2 });
			expect(visitor.mock.calls).toEqual([
				[['W'], [1, 0]],
				[['B'], [0, 1]],
			]);
		}
	);

	it('removes indentation independently from CRLF-separated grids', () => {
		const visitor = vi.fn();
		expect(
			parseTextGrids(
				'\r\n\t.W\r\n\tB.\r\n \t\r\n    .3\r\n    2.\r\n\t',
				visitor,
				{ gridCount: 2 }
			)
		).toEqual({ width: 2, height: 2 });
		expect(visitor.mock.calls).toEqual([
			[['W', '3'], [1, 0]],
			[['B', '2'], [0, 1]],
		]);
	});

	it('preserves empty cells after indentation, including trailing spaces', () => {
		const visitor = vi.fn();
		expect(parseTextGrids('  .A \n  B  ', visitor)).toEqual({
			width: 3,
			height: 2,
		});
		expect(visitor.mock.calls).toEqual([
			[['A'], [1, 0]],
			[['B'], [0, 1]],
		]);
	});

	it('still rejects ragged indented grids before visiting', () => {
		const visitor = vi.fn();
		expect(() => parseTextGrids('\t..\n\t.', visitor)).toThrow(
			'Grid 1 must have 2 columns in every row'
		);
		expect(visitor).not.toHaveBeenCalled();
	});

	it('visits non-empty positions in row-major order with zero-based coordinates', () => {
		const visitor = vi.fn();
		expect(parseTextGrids('\n.A.\nB  \n..C\n', visitor)).toEqual({
			width: 3,
			height: 3,
		});
		expect(visitor.mock.calls).toEqual([
			[['A'], [1, 0]],
			[['B'], [0, 1]],
			[['C'], [2, 2]],
		]);
	});

	it('passes values from any number of grids to the visitor', () => {
		const visitor = vi.fn();
		expect(
			parseTextGrids('A.\n..\n\n\n..\n.B\n \n..\nC.', visitor)
		).toEqual({ width: 2, height: 2 });
		const calls = [
			[
				['A', '.', '.'],
				[0, 0],
			],
			[
				['.', '.', 'C'],
				[0, 1],
			],
			[
				['.', 'B', '.'],
				[1, 1],
			],
		];
		expect(visitor.mock.calls).toEqual(calls);
	});

	it('supports CRLF grids and visits a coordinate only once', () => {
		const visitor = vi.fn();
		parseTextGrids('.W\r\n..\r\n\r\n.3\r\n..', visitor, {
			gridCount: 2,
		});
		expect(visitor.mock.calls).toEqual([
			[
				['W', '3'],
				[1, 0],
			],
		]);
	});

	it('returns dimensions without visiting empty grids', () => {
		const visitor = vi.fn();
		expect(parseTextGrids('..\n..', visitor)).toEqual({
			width: 2,
			height: 2,
		});
		expect(visitor).not.toHaveBeenCalled();
	});

	it.each(['', '\n \r\n\t'])('rejects empty input %j', (text) => {
		expect(() => parseTextGrids(text, vi.fn())).toThrow(
			'Expected at least one non-empty text grid'
		);
	});

	it.each([
		['A.\n.', 'Grid 1 must have 2 columns in every row'],
		['A.\n..\n\n..', 'Grid 2 must have 2 rows'],
		['A.\n..\n\n...\n...', 'Grid 2 must have 2 columns in every row'],
		['A.\n...\n\n..\n...', 'Grid 1 must have 2 columns in every row'],
	])('validates all dimensions before visiting %j', (text, message) => {
		const visitor = vi.fn();
		expect(() => parseTextGrids(text, visitor)).toThrow(message);
		expect(visitor).not.toHaveBeenCalled();
	});

	it('validates a required grid count before visiting', () => {
		const visitor = vi.fn();
		expect(() => parseTextGrids('A', visitor, { gridCount: 2 })).toThrow(
			'Expected 2 text grids, received 1'
		);
		expect(visitor).not.toHaveBeenCalled();
	});

	it('propagates visitor errors', () => {
		expect(() =>
			parseTextGrids('A', () => {
				throw new Error('Invalid clue');
			})
		).toThrow('Invalid clue');
	});
});

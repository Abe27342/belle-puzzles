import { describe, expect, it, vi } from 'vitest';
import { parseTextGrids } from '../text-grid.js';

describe('parseTextGrids', () => {
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

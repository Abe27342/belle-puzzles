import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CartesianGrid } from '../grid/cartesian-grid.js';
import { CartesianGridRenderer } from '../rendering/cartesian-grid-renderer.js';
describe('CartesianGridRenderer', () => {
	const logLines: string[] = [];
	beforeEach(() => {
		logLines.length = 0;
		vi.spyOn(console, 'log').mockImplementation((line: string) => {
			logLines.push(line);
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('should render a Cartesian grid', () => {
		const grid = new CartesianGrid([
			[1, 2, 3],
			[4, 5, 6],
			[7, 8, 9],
		]);
		const renderer = new CartesianGridRenderer();
		renderer.render(grid);
		expect(logLines.join('\n')).toEqual(`123\n456\n789`);
	});
});

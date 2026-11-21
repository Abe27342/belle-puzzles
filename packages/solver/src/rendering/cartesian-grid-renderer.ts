import type { Renderer } from './renderer.js';
import type { Grid } from '../grid/grid.js';
import type { CartesianCoord } from '../grid/cartesian-grid.js';
import { CartesianGrid } from '../grid/cartesian-grid.js';
import { mapIterable } from '../utils.js';

export class CartesianGridRenderer<T> implements Renderer<CartesianCoord, T> {
	#renderT: (t: T) => string;

	constructor(renderT: (t: T) => string = (t) => `${t}`) {
		this.#renderT = renderT;
	}

	public render(grid: Grid<CartesianCoord, T>): void {
		if (!(grid instanceof CartesianGrid)) {
			throw new Error('Grid must be a CartesianGrid');
		}

		const padLength = Math.max(
			...mapIterable(grid.cellValues(), (t) => this.#renderT(t).length)
		);

		for (let y = 0; y < grid.height; y++) {
			let row = '';
			for (let x = 0; x < grid.width; x++) {
				if (padLength > 1) {
					row += '|';
				}
				row += this.#padLeft(
					this.#renderT(grid.get([x, y])),
					padLength
				);
			}
			console.log(row);
		}
	}

	#padLeft(str: string, length: number): string {
		return str.padStart(length, ' ');
	}
}

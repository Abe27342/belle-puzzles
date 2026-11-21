import { mapIterable } from '../utils.js';
import type { Grid } from './grid.js';

export type CartesianCoord = [x: number, y: number];

export class CartesianGrid<T> implements Grid<CartesianCoord, T> {
	#grid: T[][];
	public readonly width: number;
	public readonly height: number;

	constructor(grid: T[][]) {
		this.height = grid.length;
		// Copy for safety
		this.#grid = [...grid].map((row) => [...row]);
		this.width = grid[0]?.length ?? 0;

		for (const row of this.#grid) {
			if (row.length !== this.width) {
				throw new Error('All rows must have the same length');
			}
		}
	}

	public static fromDimensions<T>(
		width: number,
		height: number,
		filledValue: () => T
	): CartesianGrid<T> {
		const grid: T[][] = Array.from({ length: height }, () =>
			Array.from({ length: width }, () => filledValue())
		);
		return new CartesianGrid(grid);
	}

	#validateCoord(coord: CartesianCoord): void {
		const [x, y] = coord;
		if (y < 0 || y >= this.height || x < 0 || x >= this.width) {
			throw new RangeError('Coordinate out of bounds');
		}
	}

	public set(coord: CartesianCoord, value: T): void {
		this.#validateCoord(coord);
		const [x, y] = coord;
		this.#grid[y][x] = value;
	}

	public get(coord: CartesianCoord): T {
		this.#validateCoord(coord);
		const [x, y] = coord;
		return this.#grid[y][x];
	}

	static #up = [0, -1];
	static #down = [0, 1];
	static #left = [-1, 0];
	static #right = [1, 0];

	static #deltas = [
		CartesianGrid.#up,
		CartesianGrid.#down,
		CartesianGrid.#left,
		CartesianGrid.#right,
	];

	public neighbors(coord: CartesianCoord): CartesianCoord[] {
		const [x, y] = coord;
		return CartesianGrid.#deltas
			.map(([dx, dy]) => [x + dx, y + dy] as CartesianCoord)
			.filter(
				([nx, ny]) =>
					nx >= 0 && nx < this.width && ny >= 0 && ny < this.height
			);
	}

	public cells(): Iterable<[CartesianCoord, T]> {
		const result: [CartesianCoord, T][] = [];
		for (let y = 0; y < this.height; y++) {
			for (let x = 0; x < this.width; x++) {
				result.push([[x, y], this.#grid[y][x]]);
			}
		}
		return result;
	}

	public cellValues(): Iterable<T> {
		return this.#grid.flat();
	}
}

const compareCoords = (start: CartesianCoord, end: CartesianCoord) => {
	if (start[0] < end[0]) return -1;
	if (start[0] > end[0]) return 1;
	if (start[1] < end[1]) return -1;
	if (start[1] > end[1]) return 1;
	return 0;
};

const equalCoord = (a: CartesianCoord, b: CartesianCoord) =>
	a[0] === b[0] && a[1] === b[1];

export class Edge {
	#start: CartesianCoord;
	#end: CartesianCoord;
	#grid: CartesianGrid<unknown>;

	constructor(
		start: CartesianCoord,
		end: CartesianCoord,
		grid: CartesianGrid<unknown>
	) {
		if (compareCoords(start, end) < 0) {
			this.#start = start;
			this.#end = end;
		} else {
			this.#start = end;
			this.#end = start;
		}
		const dx = Math.abs(this.#end[0] - this.#start[0]);
		const dy = Math.abs(this.#end[1] - this.#start[1]);
		if ((dx !== 0 && dy !== 0) || (dx !== 1 && dy !== 1)) {
			throw new Error('Invalid edge');
		}
		this.#grid = grid;
	}

	public toString(): string {
		return `(${JSON.stringify(this.#start)}, ${JSON.stringify(this.#end)})`;
	}

	public overlaps(other: Edge): boolean {
		return (
			equalCoord(this.#start, other.#start) ||
			equalCoord(this.#start, other.#end) ||
			equalCoord(this.#end, other.#start) ||
			equalCoord(this.#end, other.#end)
		);
	}

	public *neighbors(): Iterable<Edge> {
		const { width, height } = this.#grid;
		const yieldNeighbors = function* (
			coord: CartesianCoord
		): Iterable<CartesianCoord> {
			for (const direction of [
				[0, 1],
				[0, -1],
				[1, 0],
				[-1, 0],
			]) {
				const [dx, dy] = direction;
				const nx = coord[0] + dx;
				const ny = coord[1] + dy;
				if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
					yield [nx, ny];
				}
			}
		};

		for (const neighbor of yieldNeighbors(this.#start)) {
			if (!equalCoord(neighbor, this.#end)) {
				yield new Edge(neighbor, this.#start, this.#grid);
			}
		}
		for (const neighbor of yieldNeighbors(this.#end)) {
			if (!equalCoord(neighbor, this.#start)) {
				yield new Edge(neighbor, this.#end, this.#grid);
			}
		}
	}
}

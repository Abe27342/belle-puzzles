import { Context } from 'z3-solver';
import { getOrCreate } from '../utils.js';
import type { Grid } from './grid.js';

export type CartesianCoord = [x: number, y: number];

export class CartesianGrid<T> implements Grid<CartesianCoord, T> {
	#grid: T[][];
	public readonly width: number;
	public readonly height: number;

	#vertexCache = new Map<string, Vertex>();
	#edgeCache = new Map<string, Edge>();

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

	public get(coord: CartesianCoord | Vertex): T {
		if (coord instanceof Vertex) {
			return this.get(coord.coord);
		}

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

	public getVertex(coord: CartesianCoord): Vertex {
		return getOrCreate(
			this.#vertexCache,
			coord.toString(),
			() => new Vertex(coord, this)
		);
	}

	public *vertices(): Iterable<Vertex> {
		for (const [coord] of this.cells()) {
			yield this.getVertex(coord);
		}
	}

	public *edges(): Iterable<Edge> {
		for (const vertex of this.vertices()) {
			if (vertex.right.isInBounds()) {
				yield this.getEdge(vertex, vertex.right);
			}

			if (vertex.down.isInBounds()) {
				yield this.getEdge(vertex, vertex.down);
			}
		}
	}

	/**
	 * @remarks
	 * Caches edge objects to allow reuse based on object identity.
	 */
	public getEdge(
		start: CartesianCoord | Vertex,
		end: CartesianCoord | Vertex
	): Edge {
		let normalizedStart = start instanceof Vertex ? start.coord : start;
		let normalizedEnd = end instanceof Vertex ? end.coord : end;
		return getOrCreate(
			this.#edgeCache,
			this.#getEdgeKey(normalizedStart, normalizedEnd),
			() =>
				new Edge(
					this.getVertex(normalizedStart),
					this.getVertex(normalizedEnd),
					this
				)
		);
	}

	#getEdgeKey(start: CartesianCoord, end: CartesianCoord) {
		let normalizedStart = start;
		let normalizedEnd = end;
		if (compareCoords(normalizedStart, normalizedEnd) < 0) {
			[normalizedStart, normalizedEnd] = [normalizedEnd, normalizedStart];
		}
		return `${JSON.stringify(normalizedStart)}-${JSON.stringify(
			normalizedEnd
		)}`;
	}

	public inBounds(coord: CartesianCoord): boolean {
		const [x, y] = coord;
		return x >= 0 && x < this.width && y >= 0 && y < this.height;
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

export class Vertex {
	#grid: CartesianGrid<unknown>;
	constructor(
		public readonly coord: CartesianCoord,
		grid: CartesianGrid<unknown>
	) {
		this.#grid = grid;
	}

	public get x() {
		return this.coord[0];
	}
	public get y() {
		return this.coord[1];
	}

	public get up(): Vertex {
		return this.#grid.getVertex([this.x, this.y - 1]);
	}

	public get down(): Vertex {
		return this.#grid.getVertex([this.x, this.y + 1]);
	}

	public get left(): Vertex {
		return this.#grid.getVertex([this.x - 1, this.y]);
	}

	public get right(): Vertex {
		return this.#grid.getVertex([this.x + 1, this.y]);
	}

	public *neighbors(
		optionsArg: { includeOutOfBounds?: boolean } = {}
	): Iterable<Vertex> {
		const options = { includeOutOfBounds: false, ...optionsArg };
		const predicate = options.includeOutOfBounds
			? () => true
			: (v: Vertex) => v.isInBounds();

		if (predicate(this.up)) yield this.up;
		if (predicate(this.down)) yield this.down;
		if (predicate(this.left)) yield this.left;
		if (predicate(this.right)) yield this.right;
	}

	public toString(): string {
		return `(${this.x}, ${this.y})`;
	}

	public equal(other: Vertex): boolean {
		return equalCoord(this.coord, other.coord);
	}

	public compare(other: Vertex): number {
		return compareCoords(this.coord, other.coord);
	}

	public isInBounds(): boolean {
		return this.#grid.inBounds(this.coord);
	}
}

export class Edge {
	#start: Vertex;
	#end: Vertex;
	#grid: CartesianGrid<unknown>;

	constructor(start: Vertex, end: Vertex, grid: CartesianGrid<unknown>) {
		if (start.compare(end) < 0) {
			this.#start = start;
			this.#end = end;
		} else {
			this.#start = end;
			this.#end = start;
		}
		this.#grid = grid;

		if (
			![...this.#start.neighbors({ includeOutOfBounds: true })].some(
				(v) => v.equal(this.#end)
			)
		) {
			throw new Error(
				`Invalid edge: vertices are not neighbors: ${this.#start} - ${
					this.#end
				}`
			);
		}
	}

	public toString(): string {
		return `(${JSON.stringify(this.#start)}, ${JSON.stringify(this.#end)})`;
	}

	public overlaps(other: Edge): boolean {
		return (
			this.#start.equal(other.#start) ||
			this.#start.equal(other.#end) ||
			this.#end.equal(other.#start) ||
			this.#end.equal(other.#end)
		);
	}

	public *neighbors(
		optionsArg: { includeOutOfBounds?: boolean } = {}
	): Iterable<Edge> {
		for (const neighbor of this.#start.neighbors(optionsArg)) {
			if (!this.#end.equal(neighbor)) {
				yield new Edge(neighbor, this.#start, this.#grid);
			}
		}
		for (const neighbor of this.#end.neighbors(optionsArg)) {
			if (!this.#start.equal(neighbor)) {
				yield new Edge(neighbor, this.#end, this.#grid);
			}
		}
	}
}

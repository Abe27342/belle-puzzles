import { Context } from 'z3-solver';
import { getOrCreate } from '../utils.js';
import type { Edge, Grid, PlanarGraph, Vertex } from './grid.js';

export type CartesianCoord = [x: number, y: number];

/**
 * A representation of a 2D cartesian grid.
 * @remarks
 * The implementation takes some pain to allocate exactly one edge/vertex object per unique edge/vertex, which
 * allows constraint problem representations to safely use these objects as keys.
 */
export class CartesianGrid<T>
	implements PlanarGraph<CartesianCoord>, Grid<CartesianCoord, T>
{
	#grid: T[][];
	public readonly width: number;
	public readonly height: number;

	#vertexCache = new Map<string, GridVertex>();
	#edgeCache = new Map<string, GridEdge>();

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

	public get(coord: CartesianCoord | GridVertex): T {
		if (coord instanceof GridVertexImpl) {
			return this.get(coord.coord);
		}

		this.#validateCoord(coord as CartesianCoord);
		const [x, y] = coord as CartesianCoord;
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

	public getVertex(coord: CartesianCoord): GridVertex {
		return getOrCreate(
			this.#vertexCache,
			coord.toString(),
			() => new GridVertexImpl(coord, this)
		);
	}

	public *vertices(): Iterable<GridVertex> {
		for (const [coord] of this.cells()) {
			yield this.getVertex(coord);
		}
	}

	public *edges(): Iterable<GridEdge> {
		for (const vertex of this.vertices()) {
			if (vertex.right.isInBounds()) {
				yield this.getEdge(vertex, vertex.right);
			}

			if (vertex.down.isInBounds()) {
				yield this.getEdge(vertex, vertex.down);
			}
		}
	}

	public *edgesIncidentTo(vertex: GridVertex): Iterable<GridEdge> {
		for (const neighbor of vertex.neighbors()) {
			yield this.getEdge(vertex, neighbor.coord);
		}
	}

	/**
	 * @remarks
	 * Caches edge objects to allow reuse based on object identity.
	 */
	public getEdge(
		start: CartesianCoord | GridVertex,
		end: CartesianCoord | GridVertex
	): GridEdge {
		let normalizedStart: CartesianCoord = this.#normalizeToCoord(start);
		let normalizedEnd: CartesianCoord = this.#normalizeToCoord(end);
		return getOrCreate(
			this.#edgeCache,
			this.#getEdgeKey(normalizedStart, normalizedEnd),
			() =>
				new GridEdgeImpl(
					this.getVertex(normalizedStart),
					this.getVertex(normalizedEnd),
					this
				)
		);
	}

	#normalizeToCoord(input: CartesianCoord | GridVertex): CartesianCoord {
		return input instanceof GridVertexImpl
			? input.coord
			: (input as CartesianCoord);
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

export interface GridVertex extends Vertex<CartesianCoord> {
	x: number;
	y: number;
	up: GridVertex;
	down: GridVertex;
	left: GridVertex;
	right: GridVertex;

	compare(other: GridVertex): number;
	isInBounds(): boolean;
}

export interface GridEdge extends Edge<CartesianCoord> {}

class GridVertexImpl implements GridVertex {
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

	public get up(): GridVertex {
		return this.#grid.getVertex([this.x, this.y - 1]);
	}

	public get down(): GridVertex {
		return this.#grid.getVertex([this.x, this.y + 1]);
	}

	public get left(): GridVertex {
		return this.#grid.getVertex([this.x - 1, this.y]);
	}

	public get right(): GridVertex {
		return this.#grid.getVertex([this.x + 1, this.y]);
	}

	public *neighbors(
		optionsArg: { includeOutOfBounds?: boolean } = {}
	): Iterable<GridVertex> {
		const options = { includeOutOfBounds: false, ...optionsArg };
		const predicate = options.includeOutOfBounds
			? () => true
			: (v: GridVertex) => v.isInBounds();

		if (predicate(this.up)) yield this.up;
		if (predicate(this.down)) yield this.down;
		if (predicate(this.left)) yield this.left;
		if (predicate(this.right)) yield this.right;
	}

	public *incidentEdges() {
		for (const neighbor of this.neighbors()) {
			yield this.#grid.getEdge(this, neighbor);
		}
	}

	public toString(): string {
		return `(${this.x}, ${this.y})`;
	}

	public equal(other: GridVertex): boolean {
		return equalCoord(this.coord, other.coord);
	}

	public compare(other: GridVertex): number {
		return compareCoords(this.coord, other.coord);
	}

	public isInBounds(): boolean {
		return this.#grid.inBounds(this.coord);
	}
}

class GridEdgeImpl implements GridEdge {
	#start: GridVertex;
	#end: GridVertex;
	#grid: CartesianGrid<unknown>;

	constructor(
		start: GridVertex,
		end: GridVertex,
		grid: CartesianGrid<unknown>
	) {
		if (start.compare(end) < 0) {
			this.#start = start;
			this.#end = end;
		} else {
			this.#start = end;
			this.#end = start;
		}
		this.#grid = grid;

		// Cannot use neighbors() as it does not yield out-of-bounds neighbors,
		// and we generally allow constructing out-of-bounds edges/vertices as it allows
		// simpler handling of boundary conditions
		const { up, left, down, right } = this.#start;
		if (![up, down, left, right].some((v) => v === this.#end)) {
			throw new Error(
				`Invalid edge: vertices are not neighbors: ${this.#start} - ${
					this.#end
				}`
			);
		}
	}

	public get vertices(): [GridVertex, GridVertex] {
		return [this.#start, this.#end];
	}

	public toString(): string {
		return `(${JSON.stringify(this.#start)}, ${JSON.stringify(this.#end)})`;
	}

	public *neighbors(): Iterable<GridEdge> {
		for (const [current, other] of [
			[this.#start, this.#end],
			[this.#end, this.#start],
		]) {
			for (const neighbor of current.neighbors()) {
				if (neighbor !== other) {
					yield this.#grid.getEdge(current.coord, neighbor.coord);
				}
			}
		}
	}
}

import { getOrCreate } from '../utils.js';
import type { Edge, PlanarGraph, Vertex, Face, DirectedEdge } from './grid.js';

export type CartesianCoord = [x: number, y: number];

export type Vector = [dx: number, dy: number];

export class Direction {
	public static readonly Up: Vector = [0, -1];
	public static readonly Down: Vector = [0, 1];
	public static readonly Left: Vector = [-1, 0];
	public static readonly Right: Vector = [1, 0];
}

export interface CartesianGraphTypes {
	coord: CartesianCoord;
	vertex: GridVertex;
	edge: GridEdge;
	directedEdge: GridDirectedEdge;
	face: GridFace;
}

/**
 * A {@link PlanarGraph} representation of a 2D cartesian grid.
 *
 * Width/height is expressed in terms of number of vertices, which is in line with an m-by-n grid
 * representing the cartesian product of two paths P_m and P_n (see https://en.wikipedia.org/wiki/Path_graph)
 */
export class CartesianGridGraph implements PlanarGraph<CartesianGraphTypes> {
	#vertexCache = new Map<string, GridVertex>();
	#edgeCache = new Map<string, GridEdge>();
	#directedEdgeCache = new Map<string, GridDirectedEdge>();
	#faceCache = new Map<string, GridFace>();

	/**
	 * Width of the grid in number of vertices
	 */
	public readonly width: number;
	/**
	 * Height of the grid in number of vertices
	 */
	public readonly height: number;

	public constructor(dimensions: { width: number; height: number }) {
		this.width = dimensions.width;
		this.height = dimensions.height;
	}

	public *vertices(): Iterable<GridVertex> {
		for (let y = 0; y < this.height; y++) {
			for (let x = 0; x < this.width; x++) {
				yield this.getVertex([x, y]);
			}
		}
	}

	public *faces(): Iterable<GridFace> {
		for (let y = 0; y < this.height - 1; y++) {
			for (let x = 0; x < this.width - 1; x++) {
				yield this.getFace([x, y]);
			}
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

	public *directedEdges(): Iterable<GridDirectedEdge> {
		for (const vertex of this.vertices()) {
			for (const neighbor of vertex.neighbors()) {
				if (neighbor.isInBounds()) {
					yield this.getDirectedEdge(vertex.coord, neighbor.coord);
				}
			}
		}
	}

	public getVertex(coord: CartesianCoord): GridVertex {
		return getOrCreate(
			this.#vertexCache,
			coord.toString(),
			() => new GridVertexImpl(coord, this)
		);
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

	public getDirectedEdge(
		from: CartesianCoord | GridVertex,
		to: CartesianCoord | GridVertex
	): GridDirectedEdge {
		let normalizedFrom: CartesianCoord = this.#normalizeToCoord(from);
		let normalizedTo: CartesianCoord = this.#normalizeToCoord(to);
		return getOrCreate(
			this.#directedEdgeCache,
			`${JSON.stringify(normalizedFrom)}->${JSON.stringify(
				normalizedTo
			)}`,
			() =>
				new GridDirectedEdgeImpl(
					this.getVertex(normalizedFrom),
					this.getVertex(normalizedTo),
					this
				)
		);
	}

	/**
	 * @returns The face whose top-left corner is at the given coordinate.
	 */
	public getFace(coord: CartesianCoord): GridFace {
		return getOrCreate(
			this.#faceCache,
			coord.toString(),
			() => new GridFaceImpl(coord, this)
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
}

const compareCoords = (start: CartesianCoord, end: CartesianCoord) => {
	if (start[0] < end[0]) return -1;
	if (start[0] > end[0]) return 1;
	if (start[1] < end[1]) return -1;
	if (start[1] > end[1]) return 1;
	return 0;
};

export interface GridVertex extends Vertex<CartesianGraphTypes> {
	x: number;
	y: number;
	/**
	 * The vertex above this vertex. Can return out-of-bounds vertices.
	 */
	up: GridVertex;
	/**
	 * The vertex below this vertex. Can return out-of-bounds vertices.
	 */
	down: GridVertex;
	/**
	 * The vertex to the left of this vertex. Can return out-of-bounds vertices.
	 */
	left: GridVertex;
	/**
	 * The vertex to the right of this vertex. Can return out-of-bounds vertices.
	 */
	right: GridVertex;

	/**
	 * Compares this vertex with another vertex.
	 * @param other The other vertex to compare with.
	 * @returns A negative number if this vertex is less than the other, a positive number if greater, or 0 if equal.
	 */
	compare(other: GridVertex): number;

	/**
	 * Whether this vertex is within the bounds of the {@link CartesianGridGraph} it is part of.
	 */
	isInBounds(): boolean;

	translate(vector: Vector): GridVertex;
}

abstract class CartesianTranslatable<T> {
	abstract translate(vector: Vector): T;

	public get up() {
		return this.translate(Direction.Up);
	}

	public get down() {
		return this.translate(Direction.Down);
	}

	public get left() {
		return this.translate(Direction.Left);
	}

	public get right() {
		return this.translate(Direction.Right);
	}
}

class GridVertexImpl
	extends CartesianTranslatable<GridVertex>
	implements GridVertex
{
	#grid: CartesianGridGraph;
	constructor(
		public readonly coord: CartesianCoord,
		grid: CartesianGridGraph
	) {
		super();
		this.#grid = grid;
	}

	public get type(): 'vertex' {
		return 'vertex';
	}

	public get x() {
		return this.coord[0];
	}
	public get y() {
		return this.coord[1];
	}

	public *neighbors(): Iterable<GridVertex> {
		const predicate = (v: GridVertex) => v.isInBounds();

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

	public *outgoingEdges() {
		for (const neighbor of this.neighbors()) {
			yield this.#grid.getDirectedEdge(this, neighbor);
		}
	}

	public *incomingEdges() {
		for (const neighbor of this.neighbors()) {
			yield this.#grid.getDirectedEdge(neighbor, this);
		}
	}

	public toString(): string {
		return `(${this.x}, ${this.y})`;
	}

	public compare(other: GridVertex): number {
		return compareCoords(this.coord, other.coord);
	}

	public isInBounds(): boolean {
		const [x, y] = this.coord;
		return (
			x >= 0 && x < this.#grid.width && y >= 0 && y < this.#grid.height
		);
	}

	public translate(vector: Vector): GridVertex {
		const [dx, dy] = vector;
		return this.#grid.getVertex([this.x + dx, this.y + dy]);
	}
}

export interface GridFace extends Face<CartesianGraphTypes> {
	/**
	 * The top-left coordinate of this face.
	 */
	coord: CartesianCoord;
	namedEdges: {
		top: GridEdge;
		bottom: GridEdge;
		left: GridEdge;
		right: GridEdge;
	};
	/**
	 * The face above this face. Can return out-of-bounds faces.
	 */
	up: GridFace;
	/**
	 * The face below this face. Can return out-of-bounds faces.
	 */
	down: GridFace;
	/**
	 * The face to the left of this face. Can return out-of-bounds faces.
	 */
	left: GridFace;
	/**
	 * The face to the right of this face. Can return out-of-bounds faces.
	 */
	right: GridFace;

	/**
	 * Compares this face with another face.
	 * @param other The other face to compare with.
	 * @returns A negative number if this face is less than the other, a positive number if greater, or 0 if equal.
	 */
	compare(other: GridFace): number;

	/**
	 * Whether this face is within the bounds of the {@link CartesianGridGraph} it is part of.
	 */
	isInBounds(): boolean;

	translate(vector: Vector): GridFace;
}

class GridFaceImpl extends CartesianTranslatable<GridFace> implements GridFace {
	#grid: CartesianGridGraph;
	constructor(
		public readonly coord: CartesianCoord,
		grid: CartesianGridGraph
	) {
		super();
		this.#grid = grid;
	}

	public get type(): 'face' {
		return 'face';
	}

	public get x() {
		return this.coord[0];
	}
	public get y() {
		return this.coord[1];
	}

	public get namedEdges() {
		const topLeft = this.#grid.getVertex(this.coord);
		const topRight = topLeft.right;
		const bottomLeft = topLeft.down;
		const bottomRight = topRight.down;

		const top = this.#grid.getEdge(topLeft, topRight);
		const bottom = this.#grid.getEdge(bottomLeft, bottomRight);
		const left = this.#grid.getEdge(topLeft, bottomLeft);
		const right = this.#grid.getEdge(topRight, bottomRight);

		return { top, bottom, left, right };
	}

	public *neighbors(): Iterable<GridFace> {
		const predicate = (v: GridFace) => v.isInBounds();

		if (predicate(this.up)) yield this.up;
		if (predicate(this.down)) yield this.down;
		if (predicate(this.left)) yield this.left;
		if (predicate(this.right)) yield this.right;
	}

	public *incidentVertices(): Iterable<GridVertex> {
		const topLeft = this.#grid.getVertex(this.coord);
		const topRight = topLeft.right;
		const bottomLeft = topLeft.down;
		const bottomRight = topRight.down;

		yield topLeft;
		yield topRight;
		yield bottomLeft;
		yield bottomRight;
	}

	public *incidentEdges() {
		yield* Object.values(this.namedEdges);
	}

	public toString(): string {
		return `(${this.x}, ${this.y})`;
	}

	public compare(other: GridFace): number {
		return compareCoords(this.coord, other.coord);
	}

	public isInBounds(): boolean {
		const [x, y] = this.coord;
		return (
			x >= 0 &&
			x < this.#grid.width - 1 &&
			y >= 0 &&
			y < this.#grid.height - 1
		);
	}

	public translate(vector: Vector): GridFace {
		const [dx, dy] = vector;
		return this.#grid.getFace([this.x + dx, this.y + dy]);
	}
}

export interface GridEdge extends Edge<CartesianGraphTypes> {
	translate(vector: Vector): GridEdge;

	bearingFrom(incident: GridVertex | GridFace): Vector;
}

class GridEdgeImpl implements GridEdge {
	#start: GridVertex;
	#end: GridVertex;
	#grid: CartesianGridGraph;

	constructor(start: GridVertex, end: GridVertex, grid: CartesianGridGraph) {
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

	public get type(): 'edge' {
		return 'edge';
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
	public translate(vector: Vector): GridEdge {
		const newStart = this.#start.translate(vector);
		const newEnd = this.#end.translate(vector);
		return this.#grid.getEdge(newStart.coord, newEnd.coord);
	}

	public bearingFrom(incident: GridVertex | GridFace): Vector {
		if (![...incident.incidentEdges()].includes(this)) {
			throw new Error(
				`Edge is not incident to the given vertex/face: ${incident}`
			);
		}
		if (incident instanceof GridVertexImpl) {
			const [x1, y1] = incident.coord;
			const other = this.#start === incident ? this.#end : this.#start;
			const [x2, y2] = other.coord;
			return [x2 - x1, y2 - y1];
		} else if (incident instanceof GridFaceImpl) {
			const { top, bottom, left, right } = incident.namedEdges;
			if (this === top) return Direction.Up;
			if (this === bottom) return Direction.Down;
			if (this === left) return Direction.Left;
			if (this === right) return Direction.Right;
			throw new Error(
				`Edge is not incident to the given face: ${incident}`
			);
		}
		throw new Error(`Unsupported incident type: ${incident}`);
	}
}

export interface GridDirectedEdge extends DirectedEdge<CartesianGraphTypes> {
	translate(vector: Vector): GridDirectedEdge;
}

class GridDirectedEdgeImpl implements GridDirectedEdge {
	#from: GridVertex;
	#to: GridVertex;
	#grid: CartesianGridGraph;

	constructor(from: GridVertex, to: GridVertex, grid: CartesianGridGraph) {
		this.#from = from;
		this.#to = to;
		this.#grid = grid;

		// Cannot use neighbors() as it does not yield out-of-bounds neighbors,
		// and we generally allow constructing out-of-bounds edges/vertices as it allows
		// simpler handling of boundary conditions
		const { up, left, down, right } = this.#from;
		if (![up, down, left, right].some((v) => v === this.#to)) {
			throw new Error(
				`Invalid edge: vertices are not neighbors: ${this.#from} - ${
					this.#to
				}`
			);
		}
	}

	public get from(): GridVertex {
		return this.#from;
	}

	public get to(): GridVertex {
		return this.#to;
	}

	public get type(): 'directedEdge' {
		return 'directedEdge';
	}

	public get vertices(): [GridVertex, GridVertex] {
		return [this.#from, this.#to];
	}

	public toString(): string {
		return `(${this.#from}->${this.#to})`;
	}

	public *neighbors(): Iterable<GridDirectedEdge> {
		yield* this.predecessors();
		yield* this.successors();
	}

	public *successors(): Iterable<GridDirectedEdge> {
		for (const neighbor of this.#to.neighbors()) {
			yield this.#grid.getDirectedEdge(this.#to.coord, neighbor.coord);
		}
	}

	public *predecessors(): Iterable<GridDirectedEdge> {
		for (const neighbor of this.#from.neighbors()) {
			yield this.#grid.getDirectedEdge(neighbor.coord, this.#from.coord);
		}
	}

	public translate(vector: Vector): GridDirectedEdge {
		const newStart = this.#from.translate(vector);
		const newEnd = this.#to.translate(vector);
		return this.#grid.getDirectedEdge(newStart.coord, newEnd.coord);
	}

	public invert(): GridDirectedEdge {
		return this.#grid.getDirectedEdge(this.#to.coord, this.#from.coord);
	}
}

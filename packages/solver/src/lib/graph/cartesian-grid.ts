import { getOrCreate } from '../utils.js';
import type { Edge, PlanarGraph, Vertex, Face, DirectedEdge } from './grid.js';
import { Point, PointLike, Vector, VectorLike } from './point.js';

export type CartesianCoord = Point;
export { Point, Vector };
export type { PointLike, VectorLike };

export interface FaceGridSizeProps {
	faceWidth: number;
	faceHeight: number;
}

export interface VertexGridSizeProps {
	vertexWidth: number;
	vertexHeight: number;
}

export type GridSizeProps = FaceGridSizeProps | VertexGridSizeProps;

export class DoubledGrid {
	public static fromVertexIndices(coord: PointLike): Point {
		const point = Point.from(coord);
		return new Point(point.x * 2, point.y * 2);
	}

	public static fromFaceIndices(coord: PointLike): Point {
		const point = Point.from(coord);
		return new Point(point.x * 2 + 1, point.y * 2 + 1);
	}

	public static fromHorizontalEdgeIndices(vertexCoord: PointLike): Point {
		const point = Point.from(vertexCoord);
		return new Point(point.x * 2 + 1, point.y * 2);
	}

	public static fromVerticalEdgeIndices(vertexCoord: PointLike): Point {
		const point = Point.from(vertexCoord);
		return new Point(point.x * 2, point.y * 2 + 1);
	}

	public static Direction = {
		Up: new Vector(0, -2),
		Down: new Vector(0, 2),
		Left: new Vector(-2, 0),
		Right: new Vector(2, 0),
	};
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
 * Centers use an expanded coordinate system from (0,0) through
 * (2*faceWidth,2*faceHeight), inclusive.
 *
 * - Vertices are at even/even centers.
 * - Horizontal/vertical edges are at even/odd or odd/even centers.
 * - Faces are at odd/odd centers.
 */
export class CartesianGridGraph implements PlanarGraph<CartesianGraphTypes> {
	#vertexCache = new Map<string, GridVertex>();
	#edgeCache = new Map<string, GridEdge>();
	#directedEdgeCache = new Map<string, GridDirectedEdge>();
	#faceCache = new Map<string, GridFace>();

	public readonly faceWidth: number;
	public readonly faceHeight: number;
	public readonly vertexWidth: number;
	public readonly vertexHeight: number;

	public constructor(dimensions: GridSizeProps) {
		if ('faceWidth' in dimensions) {
			this.faceWidth = dimensions.faceWidth;
			this.faceHeight = dimensions.faceHeight;
		} else {
			this.vertexWidth = dimensions.vertexWidth;
			this.vertexHeight = dimensions.vertexHeight;
			this.faceWidth = dimensions.vertexWidth - 1;
			this.faceHeight = dimensions.vertexHeight - 1;
		}
		this.vertexWidth = this.faceWidth + 1;
		this.vertexHeight = this.faceHeight + 1;
	}

	public getFromCenter(coord: PointLike): GridVertex | GridFace | GridEdge {
		const point = Point.from(coord);
		const [x, y] = point;
		const xEven = x % 2 === 0;
		const yEven = y % 2 === 0;
		if (xEven && yEven) {
			return this.getExpandedVertex(point);
		} else if (!xEven && !yEven) {
			return this.getExpandedFace(point);
		} else {
			const start = xEven ? new Point(x, y - 1) : new Point(x - 1, y);
			const end = xEven ? new Point(x, y + 1) : new Point(x + 1, y);
			return this.getExpandedEdge(start, end);
		}
	}

	public *vertices(): Iterable<GridVertex> {
		for (let y = 0; y < this.vertexHeight; y++) {
			for (let x = 0; x < this.vertexWidth; x++) {
				yield this.getExpandedVertex(
					DoubledGrid.fromVertexIndices(new Point(x, y))
				);
			}
		}
	}

	public *faces(): Iterable<GridFace> {
		for (let y = 0; y < this.faceHeight; y++) {
			for (let x = 0; x < this.faceWidth; x++) {
				yield this.getExpandedFace(
					DoubledGrid.fromFaceIndices(new Point(x, y))
				);
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
					yield this.getDirectedEdge(vertex, neighbor);
				}
			}
		}
	}

	public getVertex(coord: PointLike): GridVertex {
		return this.getExpandedVertex(Point.from(coord));
	}

	private getExpandedVertex(point: Point): GridVertex {
		return getOrCreate(
			this.#vertexCache,
			point.toString(),
			() => new GridVertexImpl(point, this)
		);
	}

	/**
	 * @remarks
	 * Caches edge objects to allow reuse based on object identity.
	 */
	public getEdge(
		start: PointLike | GridVertex,
		end: PointLike | GridVertex
	): GridEdge {
		let normalizedStart = this.#normalizeToCoord(start);
		let normalizedEnd = this.#normalizeToCoord(end);
		return this.getExpandedEdge(normalizedStart, normalizedEnd);
	}

	private getExpandedEdge(start: Point, end: Point): GridEdge {
		return getOrCreate(
			this.#edgeCache,
			this.#getEdgeKey(start, end),
			() =>
				new GridEdgeImpl(
					this.getExpandedVertex(start),
					this.getExpandedVertex(end),
					this
				)
		);
	}

	public getDirectedEdge(
		from: PointLike | GridVertex,
		to: PointLike | GridVertex
	): GridDirectedEdge {
		let normalizedFrom = this.#normalizeToCoord(from);
		let normalizedTo = this.#normalizeToCoord(to);
		return this.getExpandedDirectedEdge(normalizedFrom, normalizedTo);
	}

	private getExpandedDirectedEdge(from: Point, to: Point): GridDirectedEdge {
		return getOrCreate(
			this.#directedEdgeCache,
			`${JSON.stringify(from)}->${JSON.stringify(to)}`,
			() =>
				new GridDirectedEdgeImpl(
					this.getExpandedVertex(from),
					this.getExpandedVertex(to),
					this
				)
		);
	}

	/**
	 * @returns The face whose top-left corner is at the given coordinate.
	 */
	public getFace(coord: PointLike): GridFace {
		return this.getExpandedFace(Point.from(coord));
	}

	private getExpandedFace(point: Point): GridFace {
		return getOrCreate(
			this.#faceCache,
			point.toString(),
			() => new GridFaceImpl(point, this)
		);
	}

	#normalizeToCoord(input: PointLike | GridVertex): Point {
		if (input instanceof GridVertexImpl) return input.coord;
		return Point.from(input as PointLike);
	}

	#getEdgeKey(start: Point, end: Point) {
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

const compareCoords = (start: Point, end: Point) => {
	if (start[0] < end[0]) return -1;
	if (start[0] > end[0]) return 1;
	if (start[1] < end[1]) return -1;
	if (start[1] > end[1]) return 1;
	return 0;
};

export interface GridVertex extends Vertex<CartesianGraphTypes> {
	x: number;
	y: number;

	center: Point;
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

	incidentFaces(): Iterable<GridFace>;

	translate(vector: Vector): GridVertex;
}

abstract class CartesianTranslatable<T> {
	abstract translate(vector: Vector): T;

	public get up() {
		return this.translate(DoubledGrid.Direction.Up);
	}

	public get down() {
		return this.translate(DoubledGrid.Direction.Down);
	}

	public get left() {
		return this.translate(DoubledGrid.Direction.Left);
	}

	public get right() {
		return this.translate(DoubledGrid.Direction.Right);
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
		return this.coord.x / 2;
	}
	public get y() {
		return this.coord.y / 2;
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
		return (
			this.x >= 0 &&
			this.x < this.#grid.vertexWidth &&
			this.y >= 0 &&
			this.y < this.#grid.vertexHeight
		);
	}

	public translate(vector: Vector): GridVertex {
		const point = this.coord.add(vector);
		const vertex = this.#grid.getFromCenter(point);
		if (vertex.type !== 'vertex') {
			throw new Error(`Expected vertex at ${point}`);
		}
		return vertex;
	}

	public *incidentFaces(): Iterable<GridFace> {
		const faces = new Set<GridFace>(
			Array.from(this.incidentEdges()).flatMap((e) =>
				Array.from(e.incidentFaces())
			)
		);

		for (const face of faces) {
			yield face;
		}
	}

	public get center(): Point {
		return this.coord;
	}
}

export interface GridFace extends Face<CartesianGraphTypes> {
	x: number;
	y: number;
	/**
	 * The top-left coordinate of this face.
	 */
	coord: CartesianCoord;

	center: Point;
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
		return (this.coord.x - 1) / 2;
	}
	public get y() {
		return (this.coord.y - 1) / 2;
	}

	public get center(): Point {
		return this.coord;
	}

	public get namedEdges() {
		const topLeft = this.#grid.getVertex(
			DoubledGrid.fromVertexIndices(new Point(this.x, this.y))
		);
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
		const topLeft = this.#grid.getVertex(
			DoubledGrid.fromVertexIndices(new Point(this.x, this.y))
		);
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
		return (
			this.x >= 0 &&
			this.x < this.#grid.faceWidth &&
			this.y >= 0 &&
			this.y < this.#grid.faceHeight
		);
	}

	public translate(vector: Vector): GridFace {
		const point = this.coord.add(vector);
		const face = this.#grid.getFromCenter(point);
		if (face.type !== 'face') {
			throw new Error(`Expected face at ${point}`);
		}
		return face;
	}
}

export interface GridEdge extends Edge<CartesianGraphTypes> {
	center: Point;

	translate(vector: Vector): GridEdge;

	isHorizontal: boolean;
	isOnBoundary(): boolean;

	incidentFaces(): Iterable<GridFace>;

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
	}

	public get center(): Point {
		return new Point(
			(this.#start.coord.x + this.#end.coord.x) / 2,
			(this.#start.coord.y + this.#end.coord.y) / 2
		);
	}

	public get type(): 'edge' {
		return 'edge';
	}

	public get vertices(): [GridVertex, GridVertex] {
		return [this.#start, this.#end];
	}

	public get isHorizontal(): boolean {
		return this.#start.y === this.#end.y;
	}

	public isOnBoundary(): boolean {
		if (this.isHorizontal) {
			return this.vertices.some(
				(v) => v.y === 0 || v.y === this.#grid.vertexHeight - 1
			);
		} else {
			return this.vertices.some(
				(v) => v.x === 0 || v.x === this.#grid.vertexWidth - 1
			);
		}
	}

	public *incidentFaces(): Iterable<GridFace> {
		const [a, b] = this.vertices;
		const minX = Math.min(a.x, b.x);
		const minY = Math.min(a.y, b.y);
		const afterFace = this.#grid.getFace(
			DoubledGrid.fromFaceIndices(new Point(minX, minY))
		);
		if (afterFace.isInBounds()) {
			yield afterFace;
		}

		const beforeIndex = this.isHorizontal
			? new Point(minX, minY - 1)
			: new Point(minX - 1, minY);
		const beforeFace = this.#grid.getFace(
			DoubledGrid.fromFaceIndices(beforeIndex)
		);
		if (beforeFace.isInBounds()) {
			yield beforeFace;
		}
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
					yield this.#grid.getEdge(current, neighbor);
				}
			}
		}
	}
	public translate(vector: Vector): GridEdge {
		const newStart = this.#start.translate(vector);
		const newEnd = this.#end.translate(vector);
		return this.#grid.getEdge(newStart, newEnd);
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
			return new Vector(x2 - x1, y2 - y1);
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
			yield this.#grid.getDirectedEdge(this.#to, neighbor);
		}
	}

	public *predecessors(): Iterable<GridDirectedEdge> {
		for (const neighbor of this.#from.neighbors()) {
			yield this.#grid.getDirectedEdge(neighbor, this.#from);
		}
	}

	public translate(vector: Vector): GridDirectedEdge {
		const newStart = this.#from.translate(vector);
		const newEnd = this.#to.translate(vector);
		return this.#grid.getDirectedEdge(newStart, newEnd);
	}

	public invert(): GridDirectedEdge {
		return this.#grid.getDirectedEdge(this.#to, this.#from);
	}
}

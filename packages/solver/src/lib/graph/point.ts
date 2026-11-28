export type PointLike = Point | readonly [x: number, y: number];

export class Point extends Array<number> implements Iterable<number> {
	public constructor(x: number, y: number) {
		super(2);
		this[0] = x;
		this[1] = y;
		Object.setPrototypeOf(this, Point.prototype);
	}

	public get x(): number {
		return this[0];
	}

	public get y(): number {
		return this[1];
	}

	public static from(value: PointLike): Point {
		return value instanceof Point ? value : new Point(value[0], value[1]);
	}

	public add(vector: VectorLike): Point {
		const value = Vector.from(vector);
		return new Point(this.x + value.dx, this.y + value.dy);
	}

	public subtract(other: PointLike): Vector {
		const point = Point.from(other);
		return new Vector(this.x - point.x, this.y - point.y);
	}

	public reflectAcross(center: PointLike): Point {
		const point = Point.from(center);
		return point.add(point.subtract(this));
	}

	public equals(other: PointLike): boolean {
		const point = Point.from(other);
		return this.x === point.x && this.y === point.y;
	}

	public toString(): string {
		return `${this.x},${this.y}`;
	}
}

export type VectorLike = Vector | readonly [dx: number, dy: number];

export class Vector extends Array<number> implements Iterable<number> {
	public constructor(dx: number, dy: number) {
		super(2);
		this[0] = dx;
		this[1] = dy;
		Object.setPrototypeOf(this, Vector.prototype);
	}

	public get dx(): number {
		return this[0];
	}

	public get dy(): number {
		return this[1];
	}

	public static from(value: VectorLike): Vector {
		return value instanceof Vector ? value : new Vector(value[0], value[1]);
	}

	public add(other: VectorLike): Vector {
		const vector = Vector.from(other);
		return new Vector(this.dx + vector.dx, this.dy + vector.dy);
	}

	public dot(other: VectorLike): number {
		const vector = Vector.from(other);
		return this.dx * vector.dx + this.dy * vector.dy;
	}

	public negate(): Vector {
		return new Vector(-this.dx, -this.dy);
	}

	public scale(factor: number): Vector {
		return new Vector(this.dx * factor, this.dy * factor);
	}

	public equals(other: VectorLike): boolean {
		const vector = Vector.from(other);
		return this.dx === vector.dx && this.dy === vector.dy;
	}

	public toString(): string {
		return `[${this.dx}, ${this.dy}]`;
	}
}

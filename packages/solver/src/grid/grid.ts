export interface Grid<TCoord, T> {
	get(coord: TCoord): T;

	set(coord: TCoord, value: T): void;

	neighbors(coord: TCoord): Iterable<TCoord>;

	cells(): Iterable<[TCoord, T]>;

	cellValues(): Iterable<T>;
}

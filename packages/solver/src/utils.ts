export function* mapIterable<T, O>(
	iterable: Iterable<T>,
	fn: (t: T) => O
): Iterable<O> {
	for (const item of iterable) {
		yield fn(item);
	}
}

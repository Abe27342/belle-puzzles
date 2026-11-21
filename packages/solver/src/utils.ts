export function* mapIterable<T, O>(
	iterable: Iterable<T>,
	fn: (t: T) => O
): Iterable<O> {
	for (const item of iterable) {
		yield fn(item);
	}
}

export function getOrCreate<K, V>(map: Map<K, V>, key: K, create: () => V): V {
	if (!map.has(key)) {
		map.set(key, create());
	}
	return map.get(key)!;
}

export function assertDefined<T>(value: T | undefined, message?: string): T {
	if (value === undefined) {
		throw new Error(message ?? 'Value is undefined');
	}
	return value;
}

export function fail(message?: string): never {
	throw new Error(message ?? 'Failed');
}

export function oob(message?: string): never {
	return fail(message ?? 'Out of bounds');
}

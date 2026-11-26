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

export function oob(obj?: any): never {
	return fail((obj ?? 'Out of bounds').toString());
}

/**
 * @returns The same array, but with typing that enforces it is not empty.
 * @remarks
 * z3-solver's variadic typing has various functions (like Sum) which require at least one argument.
 * This function is useful to satisfy those type requirements.
 */
export function ensureNonEmpty<T>(array: T[], message?: string): [T, ...T[]] {
	if (array.length === 0) {
		throw new Error(message ?? 'Array is empty');
	}
	return array as [T, ...T[]];
}

export interface ForceGetMap<TKey, TValue> extends Map<TKey, TValue> {
	forceGet(key: TKey): TValue;
}

export function createForceGetMap<TKey, TValue>(
	vals?: Iterable<[TKey, TValue]>
): ForceGetMap<TKey, TValue> {
	const map = new Map<TKey, TValue>(vals) as ForceGetMap<TKey, TValue>;
	map.forceGet = (key: TKey) => {
		return map.get(key) ?? oob(key);
	};
	return map;
}

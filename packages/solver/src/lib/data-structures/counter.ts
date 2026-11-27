export class DefaultMap<K, V> extends Map<K, V> {
	constructor(defaultValue: (key: K) => V) {
		super();
		this.#defaultValue = defaultValue;
	}

	#defaultValue: (key: K) => V;

	get(key: K): V {
		if (!this.has(key)) {
			this.set(key, this.#defaultValue(key));
		}
		return super.get(key)!;
	}
}

export class Counter<T> extends DefaultMap<T, number> {
	constructor() {
		super(() => 0);
	}

	increment(key: T, amount = 1) {
		this.set(key, this.get(key) + amount);
	}

	decrement(key: T, amount = 1) {
		this.increment(key, -amount);
	}
}

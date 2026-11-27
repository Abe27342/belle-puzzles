/**
 * Classical size-based union-find implementation with path compression.
 */
export class UnionFind<T> {
	#representatives = new Map<T, T>();
	/**
	 * When T is a root, stores the size of the set with representative T.
	 *
	 * Other data is not cleaned up but unused.
	 */
	#size = new Map<T, number>();

	constructor(members?: Iterable<T>) {
		for (const t of members ?? []) {
			this.add(t);
		}
	}

	public add(member: T) {
		this.#representatives.set(member, member);
		this.#size.set(member, 1);
	}

	public union(a: T, b: T) {
		const rootA = this.find(a);
		const rootB = this.find(b);
		if (rootA === rootB) return;

		const sizeA = this.#size.get(rootA)!;
		const sizeB = this.#size.get(rootB)!;

		const parent = sizeA < sizeB ? rootB : rootA;
		const child = sizeA < sizeB ? rootA : rootB;
		this.#representatives.set(child, parent);
		this.#size.set(parent, sizeA + sizeB);
	}

	public find(member: T): T {
		let current = member;
		while (this.#representatives.get(current) !== current) {
			const parent = this.#representatives.get(current)!;
			// Grandparent-based path compression
			this.#representatives.set(
				current,
				this.#representatives.get(parent)!
			);
			current = parent;
		}
		return current;
	}

	public areInSameSet(a: T, b: T): boolean {
		return this.find(a) === this.find(b);
	}
}

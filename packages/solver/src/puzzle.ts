import type { Solver, Model, Context } from './z3.js';
import { z3 } from './z3.js';

export abstract class Puzzle<TSolution> {
	// Class name of the extending class.
	#name: string;

	constructor() {
		this.#name = new.target.name;
	}

	public abstract getConstraints(
		context: Context<string>
	): Iterable<Parameters<Solver<string>['add']>[0]>;

	public abstract resolveSolution(model: Model<string>): TSolution;

	public async solve(): Promise<'unsat' | 'unknown' | TSolution> {
		const context = new z3.Context<string>(this.#name);
		const solver = new context.Solver();
		solver.add(...this.getConstraints(context));
		const result = await solver.check();

		if (result === 'sat') {
			const model = solver.model();
			return this.resolveSolution(model);
		}

		return result;
	}
}

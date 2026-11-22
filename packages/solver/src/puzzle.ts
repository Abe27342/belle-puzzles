import type { Solver, Context, Expr } from './z3.js';
import { z3 } from './z3.js';

export abstract class Puzzle<TVariableKey, TOutputDomain> {
	// Class name of the extending class.
	#name: string;

	constructor() {
		this.#name = new.target.name;
	}

	/**
	 * Adds all necessary constraints to represent this puzzle.
	 * @param context The Z3 context used for creating variables and expressions.
	 * @param solver The Z3 solver to which constraints should be added.
	 * @returns An iterable of Z3 expressions which uniquely determine
	 *
	 * @remarks Expressions
	 */
	public abstract addConstraints(
		context: Context<string>,
		solver: Solver<string>
	): Map<TVariableKey, Expr<string>>;

	public abstract parseAssignment(assignment: string): TOutputDomain;

	public async solve(): Promise<
		'unsat' | 'unknown' | Map<TVariableKey, TOutputDomain>
	> {
		const context = new z3.Context<string>(this.#name);
		const solver = new context.Solver();
		const variableMap = this.addConstraints(context, solver);
		const result = await solver.check();

		const assignmentMap = new Map<TVariableKey, TOutputDomain>();
		if (result === 'sat') {
			const model = solver.model();
			for (const [key, expr] of variableMap) {
				const assignment = model.eval(expr);
				assignmentMap.set(
					key,
					this.parseAssignment(assignment.toString())
				);
			}

			return assignmentMap;
		}

		return result;
	}
}

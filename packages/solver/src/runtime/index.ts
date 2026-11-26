import type { Context, Expr, Solver } from 'z3-solver';
import { resolveGraphOutput } from '../lib/graph-output.js';
import type {
	BuiltPuzzle,
	ContextExtended,
	PuzzleDefinition,
	SolveResult,
} from '../lib/puzzle.js';
import { z3 } from './z3.js';
import { createConstraintExtensions } from '../lib/constraint-utils.js';
import { ConcreteGraphTypes } from '../index.js';

export { shutdownSolverRuntime, z3 } from './z3.js';

/**
 * Builds a puzzle once and allows enumeration of unique solutions to the puzzle.
 */
export class SolverSession<
	TGraph extends ConcreteGraphTypes<TGraph>,
	TSolution
> {
	readonly #context: ContextExtended<string>;
	readonly #solver: Solver<string>;
	readonly #puzzle: BuiltPuzzle<TGraph, TSolution>;
	readonly #keys: readonly Expr<string>[];
	#previous: Expr<string>[] | undefined;
	#terminal: 'unsat' | 'unknown' | undefined;
	#running = false;

	constructor(puzzle: PuzzleDefinition<TGraph, TSolution>) {
		const context = new z3.Context<string>('puzzle');
		this.#solver = new context.Solver();
		this.#context = createConstraintExtensions(context, this.#solver);
		this.#puzzle = puzzle.build(this.#context, this.#solver);
		this.#keys = [...this.#puzzle.keyAssignments];
	}

	public async nextSolution(): Promise<SolveResult<TGraph, TSolution>> {
		if (this.#running) {
			throw new Error('A solve is already in progress for this session');
		}
		if (this.#terminal !== undefined) {
			return { status: this.#terminal };
		}

		this.#running = true;
		try {
			const previous = this.#previous;
			if (previous !== undefined) {
				// No keys means all satisfying models represent the same solution.
				const alternatives = this.#keys.map((key, index) =>
					key.neq(previous[index])
				);
				this.#solver.add(
					alternatives.length === 0
						? this.#context.Bool.val(false)
						: this.#context.Or(...alternatives)
				);
			}
			const status = await this.#solver.check();
			if (status !== 'sat') {
				this.#terminal = status;
				return { status };
			}

			const model = this.#solver.model();
			const output = resolveGraphOutput(this.#puzzle.output, model);
			const solution = this.#puzzle.decodeSolution(model, output);
			this.#previous = this.#keys.map((key) => model.eval(key, true));
			return { status, solution, output };
		} finally {
			this.#running = false;
		}
	}
}

/** Convenience entry point when only the first solution is needed. */
export function solve<TGraph extends ConcreteGraphTypes<TGraph>, TSolution>(
	puzzle: PuzzleDefinition<TGraph, TSolution>
): Promise<SolveResult<TGraph, TSolution>> {
	return new SolverSession<TGraph, TSolution>(puzzle).nextSolution();
}

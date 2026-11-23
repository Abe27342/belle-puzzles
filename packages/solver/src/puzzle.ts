import type { Solver, Context, Expr, Model } from './z3.js';
import { z3 } from './z3.js';
import {
	GraphOutput,
	GraphDisplay,
	resolveGraphOutput,
} from './graph-output.js';

export interface PuzzleDefinition<TSolution = GraphDisplay> {
	build(
		context: Context<string>,
		solver: Solver<string>
	): BuiltPuzzle<TSolution>;
}

export interface BuiltPuzzle<TSolution = GraphDisplay> {
	output: GraphOutput;
	/**
	 * Assignments that distinguish puzzle solutions. Exclude auxiliary variables
	 * such as connectivity ranks, even when they have multiple valid assignments.
	 *
	 * Two solutions should be considered unique iff they differ in at least one of the key assignments.
	 */
	keyAssignments: readonly Expr<string>[];
	decodeSolution(model: Model<string>, output: GraphDisplay): TSolution;
}

/** Default model for puzzles whose resolved display is their desired output. */
export function createGraphModel(
	output: GraphOutput,
	keyAssignments: readonly Expr<string>[]
): BuiltPuzzle {
	return {
		output,
		keyAssignments,
		decodeSolution: (_model, display) => display,
	};
}

export type SolveResult<TSolution> =
	| { status: 'sat'; solution: TSolution; output: GraphDisplay }
	| { status: 'unsat' | 'unknown' };

/**
 * Builds a puzzle once and allows enumeration of unique solutions to the puzzle.
 */
export class SolverSession<TSolution> {
	readonly #context: Context<string>;
	readonly #solver: Solver<string>;
	readonly #puzzle: BuiltPuzzle<TSolution>;
	readonly #keys: readonly Expr<string>[];
	#previous: Expr<string>[] | undefined;
	#terminal: 'unsat' | 'unknown' | undefined;
	#running = false;

	constructor(puzzle: PuzzleDefinition<TSolution>) {
		this.#context = new z3.Context<string>('puzzle');
		this.#solver = new this.#context.Solver();
		this.#puzzle = puzzle.build(this.#context, this.#solver);
		this.#keys = [...this.#puzzle.keyAssignments];
	}

	public async nextSolution(): Promise<SolveResult<TSolution>> {
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
export function solve<TSolution>(
	puzzle: PuzzleDefinition<TSolution>
): Promise<SolveResult<TSolution>> {
	return new SolverSession(puzzle).nextSolution();
}

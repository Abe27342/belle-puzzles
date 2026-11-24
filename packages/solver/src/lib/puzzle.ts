import type { Solver, Context, Expr, Model } from 'z3-solver';
import type { GraphOutput, GraphDisplay } from './graph-output.js';

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

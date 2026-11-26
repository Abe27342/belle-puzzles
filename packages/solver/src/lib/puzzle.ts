import type { Solver, Context, Expr, Model, Arith, Bool } from 'z3-solver';
import type { GraphOutput, GraphDisplay } from './graph-output.js';
import { ForceGetMap } from './utils.js';
import { ConcreteGraphTypes, PlanarGraph } from './graph/index.js';

export interface PuzzleDefinition<TSolution = GraphDisplay> {
	build(
		context: ContextExtended<string>,
		solver: Solver<string>
	): BuiltPuzzle<TSolution>;
}

/**
 * Extended interface for declaring constraints. Fixes some ergonomics issues with the base z3 libraries
 */
export interface ContextExtended<Name extends string> extends Context<Name> {
	solver: Solver<Name>;
	/**
	 * Creates a constraint that enforces the variable `a` to be within the bounds `[b, c]`.
	 *
	 * @param a The arithmetic variable to be bounded.
	 * @param b The lower bound.
	 * @param c The upper bound.
	 * @returns An arithmetic expression representing the bounded constraint.
	 */
	Bound: (a: Arith<Name>, b: number, c: number) => Bool<Name>;

	/**
	 * Like `Sum`, but doesn't require spreading or a nonempty first argument type.
	 */
	SumArray: (arr: Arith<Name>[]) => Arith<Name>;

	/**
	 * Constant expression representing the numeric value zero.
	 */
	zero: Arith<Name>;

	/**
	 * Create an integer variable for each key in some iterable, and return a {@link ForceGetMap} for the result.
	 *
	 * Integers can be optionally constrained to a minimum/maximum, inclusive on both ends.
	 */
	ints: <TKey>(
		keys: Iterable<TKey>,
		options?: Partial<{ min: number; max: number; name: string }>
	) => ForceGetMap<TKey, Arith<Name>>;

	/**
	 * Like {@link ints}, but creates indicator variables that are constrained to be 0 or 1.
	 */
	indicators: <TKey>(
		keys: Iterable<TKey>,
		options?: Partial<{ name: string }>
	) => ForceGetMap<TKey, Arith<Name>>;

	/**
	 * Expressions for constraints and expressions related to a planar graph structure.
	 */
	graphConstraints: <TConcrete extends ConcreteGraphTypes<TConcrete>>(
		graph: PlanarGraph<TConcrete>
	) => GraphConstraintExtensions<TConcrete, Name>;
}

export interface GraphConstraintExtensions<
	TConcrete extends ConcreteGraphTypes<TConcrete>,
	Name extends string
> {
	/**
	 * @returns The degree of the vertex as per edge indicator variables for edges incident to the vertex.
	 */
	degree: (
		v: TConcrete['vertex'],
		edgeIndicators: ForceGetMap<TConcrete['edge'], Arith<Name>>
	) => Arith<Name>;

	inDegree: (
		v: TConcrete['vertex'],
		edgeIndicators: ForceGetMap<TConcrete['directedEdge'], Arith<Name>>
	) => Arith<Name>;

	outDegree: (
		v: TConcrete['vertex'],
		edgeIndicators: ForceGetMap<TConcrete['directedEdge'], Arith<Name>>
	) => Arith<Name>;
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

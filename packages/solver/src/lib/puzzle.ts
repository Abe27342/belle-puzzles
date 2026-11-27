import type { Solver, Context, Expr, Model, Arith, Bool } from 'z3-solver';
import type { GraphOutput, GraphDisplay } from './graph-output.js';
import { ForceGetMap } from './utils.js';
import { ConcreteGraphTypes, PlanarGraph } from './graph/index.js';

export interface PuzzleDefinition<
	TGraph extends ConcreteGraphTypes<TGraph>,
	TSolution = GraphDisplay<TGraph>
> {
	build(
		context: ContextExtended<string>,
		solver: Solver<string>
	): BuiltPuzzle<TGraph, TSolution>;
}

/**
 * Extended interface for declaring constraints. Fixes some ergonomics issues with the base z3 libraries
 */
export interface ContextExtended<Name extends string> extends Context<Name> {
	solver: Solver<Name>;

	/**
	 * Like `Context<Name>.And`, but works on arrays.
	 * @returns
	 */
	All: (arr: Bool<Name>[]) => Bool<Name>;

	/**
	 * Creates a constraint that enforces all elements in the array to be false.
	 *
	 * @returns A boolean expression representing the constraint.
	 */
	None: (arr: Bool<Name>[]) => Bool<Name>;
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

	/**
	 * @returns Maps of variables representing an inferred division of the graph into some number of rooted subtrees, each one consisting
	 * of adjacent vertices.
	 *
	 * This set of variables is useful for puzzles that involve "connected regions of some known size", e.g. nurikabe and fillomino.
	 *
	 * BEWARE: Callers of this function should place constraints on `rootAssignments` enforcing:
	 * ```
	 * Implies(
	 *     vertex A and B have the same root assignment,
	 *     vertex A and B are in the same tree
	 * )
	 *
	 * ```
	 * Expressing this statement requires domain knowledge about the puzzle, so it is not done by the shared helper.
	 * The converse is handled automatically.
	 *
	 * @remarks
	 * TODO: These constraints can be tricky to formulate in a way that makes Z3 efficient. Add guidance on the types of constraints that callers should add
	 * to enable efficient deduction similar to the one above, or figure out better ways to encapsulate things.
	 */
	treeStructureVariables: () => {
		/**
		 * The number of vertices in the subtree rooted at each vertex.
		 */
		subtreeSizes: ForceGetMap<TConcrete['vertex'], Arith<Name>>;
		/**
		 * Whether or not each directed edge is enabled in the tree structure
		 */
		edgeIndicators: ForceGetMap<TConcrete['directedEdge'], Arith<Name>>;
		/**
		 * Maps each vertex to the id of the vertex of its structural tree root.
		 */
		rootAssignments: ForceGetMap<TConcrete['vertex'], Arith<Name>>;
	};
}

export interface BuiltPuzzle<
	TGraph extends ConcreteGraphTypes<TGraph>,
	TSolution = GraphDisplay<TGraph>
> {
	output: GraphOutput<TGraph>;
	/**
	 * Assignments that distinguish puzzle solutions. Exclude auxiliary variables
	 * such as connectivity ranks, even when they have multiple valid assignments.
	 *
	 * Two solutions should be considered unique iff they differ in at least one of the key assignments.
	 */
	keyAssignments: readonly Expr<string>[];
	decodeSolution(
		model: Model<string>,
		output: GraphDisplay<TGraph>
	): TSolution;
}

/** Default model for puzzles whose resolved display is their desired output. */
export function createGraphModel<TGraph extends ConcreteGraphTypes<TGraph>>(
	output: GraphOutput<TGraph>,
	keyAssignments: readonly Expr<string>[]
): BuiltPuzzle<TGraph> {
	return {
		output,
		keyAssignments,
		decodeSolution: (_model, display) => display,
	};
}

export type SolveResult<TGraph extends ConcreteGraphTypes<TGraph>, TSolution> =
	| { status: 'sat'; solution: TSolution; output: GraphDisplay<TGraph> }
	| { status: 'unsat' | 'unknown' };

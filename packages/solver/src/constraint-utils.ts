/**
 * Utility functions for defining commonly occurring constraints in puzzles.
 *
 */

import { Arith, Bool, Context, Solver } from 'z3-solver';
import { oob } from './utils';

/**
 * Abstract representation of a vertex in a graph that can provide its neighboring vertices.
 *
 * Constraint utilities that only depend on connectivity information are conveniently agnostic to
 * the underlying grid structure, allowing reuse of constraint representations across different grid types
 * (cartesian, hexagonal, etc).
 */
export interface HasNeighbors<T extends HasNeighbors<T>> {
	neighbors(options: { includeOutOfBounds: boolean }): Iterable<T>;
}

/**
 * Ergonomic helpers for expressing common constraints.
 */
export interface ConstraintExtensions {
	/**
	 * Creates a constraint that enforces the variable `a` to be within the bounds `[b, c]`.
	 *
	 * @param a The arithmetic variable to be bounded.
	 * @param b The lower bound.
	 * @param c The upper bound.
	 * @returns An arithmetic expression representing the bounded constraint.
	 */
	bound: (a: Arith<string>, b: number, c: number) => Bool<string>;

	/**
	 * Creates an indicator variable (0 or 1) with the provided name.
	 */
	createIndicator: (solver: Solver<string>, name: string) => Arith<string>;
}

export function createConstraintExtensions(
	context: Context<string>
): ConstraintExtensions {
	const { And, Int } = context;
	const bound = (a: Arith<string>, b: number, c: number) =>
		And(a.ge(b), a.le(c));

	const createIndicator = (solver: Solver<string>, name: string) => {
		const variable = Int.const(name);
		solver.add(bound(variable, 0, 1));
		return variable;
	};
	return { bound, createIndicator };
}

/**
 * Given a set of indicator variables with some underlying topology (expressed via {@link HasNeighbors}),
 * yields a set of constraints that enforce all enabled variables form a single connected component.
 *
 * The specific constraints used force the existence of a function f: V(G) => { -1, 1, 2, ..., |V(G)| } such that:
 * - f(v) = -1 if vertex v is disabled
 * - f(v) >= 1 if vertex v is enabled.
 * - For each vertex v with f(v) > 1, there exists an adjacent vertex u with f(u) < f(v) and f(u) != -1.
 *
 * Intuitively, when a graph has a single connected component, this is possible to achieve by an algorithm like:
 * - Assign all disabled vertices -1
 * - Pick an arbitrary enabled vertex and assign it 1
 * - Flow outward from already assigned vertices via BFS, assign each newly reached vertex the next available smallest number
 *
 * And when a graph has more than one connected component, at least one of those components does not contain a vertex with f(v) = 1,
 * which means its minimum assignment from f will be greater than 1, and therefore cannot satisfy constraint 3.
 *
 * For details, see this paper:
 * https://www.cs.ru.nl/bachelors-theses/2021/Gerhard_van_der_Knijff___1006946___Solving_and_generating_puzzles_with_a_connectivity_constraint.pdf
 *
 * @remarks
 * The graph these constraints operate on does not need to conceptually align with the graph the rest of the puzzle generally uses.
 *
 * E.g. closed-loop puzzles frequently use edge indicator variables, which results in this function operating on the {@link https://en.wikipedia.org/wiki/Incidence_(graph) | Incidence Graph}
 * (such that "vertex" variable naming in the code below actually refers to edges in the original puzzle graph).
 */
export function* connectedConstraints<T extends HasNeighbors<T>>(
	indicatorVariables: Map<HasNeighbors<T>, Arith<string>>,
	context: Context<string>
) {
	const vertices = Array.from(indicatorVariables.keys());
	const connectivityVariables = new Map<HasNeighbors<T>, Arith<string>>();

	const { bound } = createConstraintExtensions(context);

	const { Int, Or, And, Implies } = context;
	for (const v of vertices) {
		const conVar = Int.const(`connectivity_${v}`);
		connectivityVariables.set(v, conVar);
		const edgeVariable = indicatorVariables.get(v) ?? oob(v);
		yield* [
			// If all vertices are in one connected component, the assignment gives them values 1, 2, ..., up to the number of vertices.
			bound(conVar, -1, vertices.length),
			Implies(edgeVariable.eq(0), conVar.eq(-1)),
			Implies(edgeVariable.eq(1), conVar.ge(1)),
		];
	}

	// This constraint enforces connectivity.
	// Intuitively, this constraint can be satisfied on a connected graph by assigning an arbitrary vertex 1 and cascading outwards
	// with increasing values via BFS or something like that.
	// See this paper for more details:
	// https://www.cs.ru.nl/bachelors-theses/2021/Gerhard_van_der_Knijff___1006946___Solving_and_generating_puzzles_with_a_connectivity_constraint.pdf
	for (const v of vertices) {
		const connectivityVar = connectivityVariables.get(v) ?? oob(v);

		const adjacent = Array.from(
			v.neighbors({ includeOutOfBounds: false })
		).map((e) => connectivityVariables.get(e) ?? oob(e));

		// Either this vertex is assigned -1 (not part of the connected component),
		// 1 (the lowest part of the connected component),
		// or it has an adjacent vertex with a lower connectivity value.
		yield Or(
			connectivityVar.eq(-1),
			connectivityVar.eq(1),
			...adjacent.map((e) => And(e.le(connectivityVar), e.neq(-1)))
		);
	}
}

/**
 * Like {@link connectedConstraints}, but additionally enforces that enabled vertices (as determined by indicator variables)
 * form a single closed loop.
 *
 * @remarks
 * When used on the incidence graph, this is the "one connected loop" constraint used in slitherlink, masyu, etc.
 *
 * @privateRemarks
 * One could extend this to work with eulerian cycles pretty easily by extending the eq(2) to
 */
export function* connectedLoopConstraints<T extends HasNeighbors<T>>(
	indicatorVariables: Map<HasNeighbors<T>, Arith<string>>,
	context: Context<string>
) {
	yield* connectedConstraints(indicatorVariables, context);

	const { Or, Int } = context;

	const zeroVar = Int.const('zero');
	yield zeroVar.eq(0);

	for (const [edge, edgeVar] of indicatorVariables) {
		const degree = Array.from(
			edge.neighbors({ includeOutOfBounds: false }),
			(e) => indicatorVariables.get(e) ?? oob(e)
		).reduce((acc, curr) => acc.add(curr), zeroVar);

		yield Or(edgeVar.eq(0), degree.eq(2));
	}
}

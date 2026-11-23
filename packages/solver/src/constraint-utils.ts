/**
 * Utility functions for defining commonly occurring constraints in puzzles.
 *
 */

import { Arith, Bool, Context, Solver } from 'z3-solver';
import { ensureNonEmpty, oob } from './utils.js';
import {
	CartesianGridGraph,
	HasNeighbors,
	GridVertex,
	GridEdge,
	GridFace,
} from './graph/index.js';

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
	 * Creates a constraint that represents logical equivalence between two boolean variables.
	 * @param a The first boolean variable.
	 * @param b The second boolean variable.
	 * @returns A boolean expression representing the logical equivalence of `a` and `b`.
	 */
	iff: (a: Bool<string>, b: Bool<string>) => Bool<string>;

	/**
	 * Creates an indicator variable (0 or 1) with the provided name.
	 */
	createIndicator: (solver: Solver<string>, name: string) => Arith<string>;
}

export function createConstraintExtensions(
	context: Context<string>
): ConstraintExtensions {
	const { And, Int, Implies } = context;
	const bound = (a: Arith<string>, b: number, c: number) =>
		And(a.ge(b), a.le(c));

	const createIndicator = (solver: Solver<string>, name: string) => {
		const variable = Int.const(name);
		solver.add(bound(variable, 0, 1));
		return variable;
	};

	const iff = (a: Bool<string>, b: Bool<string>) =>
		And(Implies(a, b), Implies(b, a));
	return { bound, iff, createIndicator };
}

/**
 * Given a set of indicator variables with some underlying topology (expressed via {@link HasNeighbors}),
 * yields a set of constraints that enforce all enabled variables form a single connected component.
 *
 * The specific constraints used force the existence of a function f: V(G) => { -1, 0, 1, 2, ..., |V(G)| } such that:
 * - f(v) >= 0 iff vertex v is enabled.
 * - Exactly one vertex has f(v) = 0.
 * - For each vertex v with f(v) > 0, there exists an adjacent vertex u with f(u) < f(v) and f(u) != -1.
 *
 * Intuitively, when a graph has a single connected component, this is possible to achieve by an algorithm like:
 * - Assign all disabled vertices -1
 * - Pick an arbitrary enabled vertex and assign it 0
 * - Flow outward from already assigned vertices via BFS, assign each newly reached vertex the next available smallest number
 *
 * And when a graph has more than one connected component, at least one of those components does not contain a vertex with f(v) = 0,
 * which means its minimum assignment from f will be greater than 0, and therefore cannot satisfy constraint 3.
 *
 * For details, see this paper:
 * https://www.cs.ru.nl/bachelors-theses/2021/Gerhard_van_der_Knijff___1006946___Solving_and_generating_puzzles_with_a_connectivity_constraint.pdf
 *
 * @param indicatorVariables - A map from vertices to their corresponding indicator variables, which indicate whether the vertex is enabled.
 * @param minimalEnabledVariables - An iterable of vertices such that at least one of them must be enabled. The smaller the set, the better.
 * @remarks
 * The graph these constraints operate on does not need to conceptually align with the graph the rest of the puzzle generally uses.
 *
 * E.g. closed-loop puzzles frequently use edge indicator variables, which results in this function operating on the {@link https://en.wikipedia.org/wiki/Incidence_(graph) | Incidence Graph}
 * (such that "vertex" variable naming in the code below actually refers to edges in the original puzzle graph).
 */
export function* connectedConstraints<T extends HasNeighbors<T>>(
	indicatorVariables: Map<HasNeighbors<T>, Arith<string>>,
	minimalEnabledVariables: Iterable<HasNeighbors<T>>,
	context: Context<string>
) {
	const vertices = Array.from(indicatorVariables.keys());
	const connectivityVariables = new Map<HasNeighbors<T>, Arith<string>>();

	const { bound, iff } = createConstraintExtensions(context);
	const { Int, Or, And, Implies } = context;
	const possibleZeroVertices = new Set(minimalEnabledVariables);

	for (const v of vertices) {
		const conVar = Int.const(`connectivity_${v}`);
		connectivityVariables.set(v, conVar);
		const edgeVariable = indicatorVariables.get(v) ?? oob(v);
		yield* [
			bound(conVar, -1, vertices.length),
			iff(edgeVariable.eq(0), conVar.eq(-1)),
			iff(edgeVariable.eq(1), conVar.ge(0)),
		];
	}

	const varFor = (v: HasNeighbors<T>) =>
		connectivityVariables.get(v) ?? oob(v);
	// In this block, we enforce that exactly one of the minimal enabled variables is assigned 0, and all other vertices are non-zero.
	// This would be expressible without `minimalEnabledVertices`, but the obvious way uses O(N^2) terms.
	{
		// Enforce that at least one of the minimal enabled variables is enabled.
		yield Or(
			...Array.from(possibleZeroVertices).map((v) => varFor(v).eq(0))
		);
		for (const variable of possibleZeroVertices) {
			// Enforce that exactly one of the minimal enabled variables is 0.
			yield Implies(
				varFor(variable).eq(0),
				And(
					...Array.from(possibleZeroVertices)
						.filter((v) => v !== variable)
						.map((v) => varFor(v).neq(0))
				)
			);
		}

		for (const v of vertices) {
			// Enforce that vertices not in `possibleZeroVertices` cannot be assigned 0.
			if (!possibleZeroVertices.has(v)) {
				yield varFor(v).neq(0);
			}
		}
	}

	// This constraint enforces connectivity.
	// Intuitively, this constraint can be satisfied on a connected graph by assigning an arbitrary vertex 1 and cascading outwards
	// with increasing values via BFS or something like that.
	// See this paper for more details:
	// https://www.cs.ru.nl/bachelors-theses/2021/Gerhard_van_der_Knijff___1006946___Solving_and_generating_puzzles_with_a_connectivity_constraint.pdf
	for (const v of vertices) {
		const connectivityVar = connectivityVariables.get(v) ?? oob(v);

		const adjacent = Array.from(v.neighbors()).map(varFor);

		// Constraint 3 from the doc comment.
		yield Or(
			connectivityVar.eq(-1),
			connectivityVar.eq(0),
			...adjacent.map((e) => And(e.lt(connectivityVar), e.neq(-1)))
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
	minimalEnabledVariables: Iterable<HasNeighbors<T>>,
	context: Context<string>
) {
	yield* connectedConstraints(
		indicatorVariables,
		minimalEnabledVariables,
		context
	);

	const { Or, Int } = context;

	const zeroVar = Int.const('zero');
	yield zeroVar.eq(0);

	for (const [edge, edgeVar] of indicatorVariables) {
		const degree = Array.from(
			edge.neighbors(),
			(e) => indicatorVariables.get(e) ?? oob(e)
		).reduce((acc, curr) => acc.add(curr), zeroVar);

		yield Or(edgeVar.eq(0), degree.eq(2));
	}
}

/**
 * Given a vertex or face `v` and a count `count`, this constraint ensures that exactly `count` vertices are visible in
 * straight lines from `v`, including `v` itself.
 *
 * visibility is determined by the presence of edges along straight lines from `v` based on `v`'s type
 * (when `v` is a vertex, the edge must be present, and when `v` is a face, the edge must be absent)
 *
 * @remarks
 * This should generalize to non-cartesian grids operating on their vertices.
 *
 * It works for cartesian grid faces in addition to vertices because that grid is self-dual
 * (so e.g. translating an edge is well-defined for a sight line, and can be understood
 * as an equivalent problem on the dual graph)
 */
export function* sightLineSumConstraints(
	context: Context<string>,
	v: GridFace | GridVertex,
	count: number,
	edgeIndicators: Map<GridEdge, Arith<string>>
) {
	const { Int, Sum, Implies, And, Not } = context;
	const zero = Int.const('zero');
	yield zero.eq(0);

	const allowsVisibility =
		v.type === 'face'
			? (indicator: Arith<string>) => indicator.eq(0)
			: (indicator: Arith<string>) => indicator.eq(1);

	const getEdgeVar = (e: GridEdge) => edgeIndicators.get(e) ?? zero;
	const variables: Arith<string>[] = [];
	// Variables in each direction representing the number of straight-line faces visible from this face,
	// including the starting face.
	for (const edge of v.incidentEdges()) {
		const bearing = edge.bearingFrom(v);
		const variable = Int.const(`F${v}_B${bearing}`);
		yield variable.ge(1).and(variable.le(count));
		variables.push(variable);

		// Bind straight-line visibility for this direction to the relevant edge indicator variables.
		const nonBlockingEdges: GridEdge[] = [];
		let blockingEdge = edge;
		for (
			let directionalCount = 1;
			directionalCount <= count;
			directionalCount++
		) {
			yield Implies(
				variable.eq(directionalCount),
				And(
					...nonBlockingEdges.map((e) =>
						allowsVisibility(getEdgeVar(e))
					),
					Not(allowsVisibility(getEdgeVar(blockingEdge)))
				)
			);

			nonBlockingEdges.push(blockingEdge);
			blockingEdge = blockingEdge.translate(bearing);
		}
	}

	// The RHS of this fixes the fact that we overcounted the starting vertex (we counted it once for each direction).
	yield Sum(...ensureNonEmpty(variables)).eq(count + variables.length - 1);
}

/**
 * Utility functions for defining constraints on a Cartesian grid in terms of indicator variables.
 */
export interface CartesianGridConstraintUtils {
	/** Constraints and utility functions on edge incidence variables used to construct the utils */
	edges: {
		/**
		 * @returns The edge indicator variable, or an always-zero indicator variable if the edge is out-of-bounds.
		 */
		getEdgeVar: (e: GridEdge) => Arith<string>;
		/**
		 * Edges pass vertically through this vertex
		 */
		goesVerticallyThrough: (v: GridVertex) => Bool<string>;
		/**
		 * Edges pass horizontally through this vertex
		 */
		goesHorizontallyThrough: (v: GridVertex) => Bool<string>;
		/**
		 * At least one edge passes horizontally through this vertex
		 */
		hasHorizontalEdge: (v: GridVertex) => Bool<string>;
		/**
		 * At least one edge passes vertically through this vertex
		 */
		hasVerticalEdge: (v: GridVertex) => Bool<string>;
		/**
		 * @returns an iterable of edge indicator variables corresponding to the run in the specified direction and length.
		 * Out-of-bounds vertices use an always-zero indicator variable.
		 *
		 * @example
		 * // yields the edge indicator variables for edges ([0, 1], [1, 1]), ([1, 1], [2, 1]), ([2, 1], [3, 1])
		 * directionalRun([0, 1], 'right', 3);
		 */
		directionalRun: (
			v: GridVertex,
			direction: 'up' | 'down' | 'left' | 'right',
			length: number
		) => Iterable<Arith<string>>;
	};
	/**
	 * Masyu constraints on edge incidence variables used to construct the utils.
	 */
	masyu: MasyuConstraints;
	/**
	 * Shingoki constraints on edge incidence variables used to construct the utils.
	 */
	shingoki: ShingokiConstraints;
}

/**
 * Pearl constraints for Masyu puzzles on a Cartesian grid.
 */
export interface MasyuConstraints {
	/**
	 * The loop turns 90 degrees at this vertex, and continues straight on either side.
	 */
	blackPearl: (v: GridVertex) => Bool<string>;
	/**
	 * The loop goes straight through this vertex, but turns on at least one adjacent vertex.
	 */
	whitePearl: (v: GridVertex) => Bool<string>;
}

export interface ShingokiConstraints {
	/**
	 * The loop turns 90 degrees at this vertex.
	 */
	blackPearl: (v: GridVertex) => Bool<string>;
	/**
	 * The loop passes straight through this vertex.
	 */
	whitePearl: (v: GridVertex) => Bool<string>;
}

export function createCartesianGridConstraintUtils(
	context: Context<string>,
	solver: Solver<string>,
	grid: CartesianGridGraph,
	edgeIndicators: Map<GridEdge, Arith<string>>
): CartesianGridConstraintUtils {
	const { Int, And, Or } = context;

	const zeroVar = Int.const('zero');
	solver.add(zeroVar.eq(0));

	const getEdgeVar = (edge: GridEdge) => edgeIndicators.get(edge) ?? zeroVar;
	const getEdgeVarFromEndpoints = (a: GridVertex, b: GridVertex) => {
		const edge = grid.getEdge(a, b);
		return getEdgeVar(edge);
	};

	// Some predicates that are helpful for defining constraints related to pearl colors.
	const goesVerticallyThrough = (v: GridVertex) =>
		And(
			getEdgeVarFromEndpoints(v, v.up).eq(1),
			getEdgeVarFromEndpoints(v, v.down).eq(1)
		);

	const goesHorizontallyThrough = (v: GridVertex) =>
		And(
			getEdgeVarFromEndpoints(v, v.left).eq(1),
			getEdgeVarFromEndpoints(v, v.right).eq(1)
		);

	// Whether one of the horizontal edges adjacent to the vertex is used.
	const hasHorizontalEdge = (v: GridVertex) =>
		Or(
			getEdgeVarFromEndpoints(v, v.left).eq(1),
			getEdgeVarFromEndpoints(v, v.right).eq(1)
		);

	// Whether one of the vertical edges adjacent to the vertex is used.
	const hasVerticalEdge = (v: GridVertex) =>
		Or(
			getEdgeVarFromEndpoints(v, v.up).eq(1),
			getEdgeVarFromEndpoints(v, v.down).eq(1)
		);

	const directionalRun = function* (
		v: GridVertex,
		direction: 'up' | 'down' | 'left' | 'right',
		length: number
	) {
		let current = v;
		for (let i = 0; i < length; i++) {
			const next = current[direction];
			yield getEdgeVarFromEndpoints(current, next);
			current = next;
		}
	};

	const adjacentToFaceCoordinate = (v: GridVertex) => {
		const top = getEdgeVarFromEndpoints(v, v.right);
		const left = getEdgeVarFromEndpoints(v, v.down);
		const bottom = getEdgeVarFromEndpoints(v.down, v.down.right);
		const right = getEdgeVarFromEndpoints(v.right, v.right.down);
		return { top, left, bottom, right };
	};

	const masyu = {
		blackPearl: (v: GridVertex) => {
			const leftUsed = goesHorizontallyThrough(v.left);
			const rightUsed = goesHorizontallyThrough(v.right);
			const downUsed = goesVerticallyThrough(v.down);
			const upUsed = goesVerticallyThrough(v.up);
			return Or(
				And(downUsed, Or(leftUsed, rightUsed)),
				And(upUsed, Or(leftUsed, rightUsed))
			);
		},
		whitePearl: (v: GridVertex) => {
			return Or(
				And(
					goesVerticallyThrough(v),
					Or(hasHorizontalEdge(v.up), hasHorizontalEdge(v.down))
				),
				And(
					goesHorizontallyThrough(v),
					Or(hasVerticalEdge(v.left), hasVerticalEdge(v.right))
				)
			);
		},
	};

	const shingoki = {
		blackPearl: (v: GridVertex) => {
			const leftUsed = getEdgeVarFromEndpoints(v, v.left).eq(1);
			const rightUsed = getEdgeVarFromEndpoints(v, v.right).eq(1);
			const downUsed = getEdgeVarFromEndpoints(v, v.down).eq(1);
			const upUsed = getEdgeVarFromEndpoints(v, v.up).eq(1);
			return Or(
				And(downUsed, Or(leftUsed, rightUsed)),
				And(upUsed, Or(leftUsed, rightUsed))
			);
		},
		whitePearl: (v: GridVertex) => {
			const leftUsed = getEdgeVarFromEndpoints(v, v.left).eq(1);
			const rightUsed = getEdgeVarFromEndpoints(v, v.right).eq(1);
			const downUsed = getEdgeVarFromEndpoints(v, v.down).eq(1);
			const upUsed = getEdgeVarFromEndpoints(v, v.up).eq(1);
			return Or(And(downUsed, upUsed), And(leftUsed, rightUsed));
		},
	};

	return {
		edges: {
			getEdgeVar,
			goesVerticallyThrough,
			goesHorizontallyThrough,
			hasHorizontalEdge,
			hasVerticalEdge,
			directionalRun,
		},
		masyu,
		shingoki,
	};
}

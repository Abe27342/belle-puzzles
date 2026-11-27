/**
 * Utility functions for defining commonly occurring constraints in puzzles.
 */

import type { Arith, Bool, Context, Solver } from 'z3-solver';
import {
	createForceGetMap,
	ensureNonEmpty,
	ForceGetMap,
	oob,
} from './utils.js';
import {
	CartesianGridGraph,
	HasNeighbors,
	PlanarGraph,
	ConcreteGraphTypes,
	GridVertex,
	GridEdge,
	GridFace,
	CartesianGraphTypes,
} from './graph/index.js';
import type { ContextExtended, GraphConstraintExtensions } from './puzzle.js';

export function createConstraintExtensions<Name extends string>(
	context: Context<Name>,
	solver: Solver<Name>
): ContextExtended<Name> {
	const { And, Sum } = context;
	const bound = (a: Arith<Name>, b: number, c: number) =>
		And(a.ge(b), a.le(c));

	const All: (arr: Bool<Name>[]) => Bool<Name> = (arr) => And(...arr);

	const None: (arr: Bool<Name>[]) => Bool<Name> = (arr) =>
		And(...arr.map((x) => x.not()));

	const zero = context.Int.const('zero');
	solver.add(zero.eq(0));

	const ints = <TKey>(
		keys: Iterable<TKey>,
		optionsArg?: Partial<{ min: number; max: number; name: string }>
	): ForceGetMap<TKey, Arith<Name>> => {
		const options = optionsArg ?? {};
		const map = createForceGetMap<TKey, Arith<Name>>();
		for (const key of keys) {
			const variable = context.Int.const(
				`${options.name ?? ''}_${key}_${crypto.randomUUID()}`
			);

			if (options.min !== undefined) {
				solver.add(variable.ge(options.min));
			}
			if (options.max !== undefined) {
				solver.add(variable.le(options.max));
			}

			map.set(key, variable);
		}

		return map;
	};

	const indicators = <TKey>(
		keys: Iterable<TKey>,
		optionsArg?: Partial<{ name: string }>
	): ForceGetMap<TKey, Arith<Name>> => {
		return ints(keys, { min: 0, max: 1, name: optionsArg?.name });
	};

	const extendedContext: Omit<ContextExtended<Name>, 'graphConstraints'> = {
		...context,
		solver,
		All,
		None,
		Bound: bound,
		SumArray: (arr: Arith<Name>[]) =>
			Sum(...ensureNonEmpty(arr.length > 0 ? arr : [zero])),
		zero,
		ints,
		indicators,
	};

	return {
		...extendedContext,
		graphConstraints: (graph) =>
			createGraphConstraintUtils(extendedContext, graph),
	};
}

/**
 * Given a set of value variables with some underlying topology (expressed via {@link HasNeighbors}),
 * yields a set of constraints that enforce all enabled variables form a single connected component.
 * Nonnegative values are treated as indicators under the predicate "enabled if > 0".
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
 * @param valueVariables - A map from vertices to their corresponding nonnegative values, which indicate whether the vertex is enabled.
 * @param minimalEnabledVariables - An iterable of vertices such that at least one of them must be enabled. The smaller the set, the better.
 * @param good - A predicate that determines whether a variable is considered to be enabled. Defaults to checking if the value is greater than 0.
 * @remarks
 * The graph these constraints operate on does not need to conceptually align with the graph the rest of the puzzle generally uses.
 *
 * E.g. closed-loop puzzles frequently use edge indicator variables, which results in this function operating on the {@link https://en.wikipedia.org/wiki/Line_graph | line graph}
 * (such that "vertex" variable naming in the code below actually refers to edges in the original puzzle graph).
 */
export function* connectedConstraints<T extends HasNeighbors<T>>(
	context: ContextExtended<string>,
	valueVariables: ForceGetMap<HasNeighbors<T>, Arith<string>>,
	minimalEnabledVariables: Iterable<HasNeighbors<T>>,
	good: (v: Arith<string>) => Bool<string> = (v) => v.gt(0)
) {
	const { Or, And, Implies, Iff, Not } = context;

	const vertices = Array.from(valueVariables.keys());
	const connectivityVariables = context.ints(vertices, {
		min: -1,
		max: vertices.length,
		name: 'connectivity',
	});
	const possibleZeroVertices = new Set(minimalEnabledVariables);

	for (const v of vertices) {
		const valueVariable = valueVariables.forceGet(v);
		const conVar = connectivityVariables.forceGet(v);
		yield* [
			Iff(Not(good(valueVariable)), conVar.eq(-1)),
			Iff(good(valueVariable), conVar.ge(0)),
		];
	}

	const varFor = (v: HasNeighbors<T>) => connectivityVariables.forceGet(v);
	// In this block, we enforce that exactly one of the minimal enabled variables is assigned 0, and all other vertices are non-zero.
	// This would be expressible without `minimalEnabledVariables`, but the obvious way uses O(N^2) terms.
	{
		// Enforce that at least one of the minimal enabled variables is enabled.
		yield Or(
			...Array.from(possibleZeroVertices).map((v) =>
				connectivityVariables.forceGet(v).eq(0)
			)
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
 * form a single closed loop. Indicator values must be 0 or 1.
 *
 * @remarks
 * When used on the line graph, this is the "one connected loop" constraint used in slitherlink, masyu, etc.
 */
export function* connectedLoopConstraints<T extends ConcreteGraphTypes<T>>(
	context: ContextExtended<string>,
	graph: PlanarGraph<T>,
	indicatorVariables: ForceGetMap<T['edge'], Arith<string>>,
	minimalEnabledVariables: Iterable<T['edge']>
) {
	yield* connectedConstraints(
		context,
		indicatorVariables,
		minimalEnabledVariables
	);

	for (const v of graph.vertices()) {
		const degree = context
			.graphConstraints(graph)
			.degree(v, indicatorVariables);
		yield context.Or(degree.eq(0), degree.eq(2));
	}
}

/**
 * @returns an iterable of all neighbors that are at most `steps` away from the given vertex.
 *
 * @remarks
 * I implemented this for Ripple Effect, at the time misunderstanding the constraint as requiring all neighbors within a certain distance to be considered.
 * It might be useful for some other puzzle types, so leaving it around for now.
 */
export function* nearestNeighbors<T extends HasNeighbors<T>>(
	vertex: T,
	steps: number,
	visited: Set<T> = new Set()
): Iterable<T> {
	if (visited.has(vertex)) {
		return;
	}

	visited.add(vertex);
	yield vertex;

	if (steps > 0) {
		for (const neighbor of vertex.neighbors()) {
			// This implementation works for both vertices and faces
			yield* nearestNeighbors(neighbor, steps - 1, visited);
		}
	}
}

/**
 * Given a vertex or face `v` and a count `count`, this constraint ensures that exactly `count` vertices or faces are visible in
 * straight lines from `v`, including `v` itself.
 *
 * visibility is determined by the presence of edges along straight lines from `v` based on `v`'s type
 * (when `v` is a vertex, the edge must be present, and when `v` is a face, the edge must be absent)
 *
 * @remarks
 * This should generalize to non-cartesian grids operating on their vertices.
 *
 * It also works for Cartesian grid faces by interpreting them as vertices of the dual graph;
 * translating an edge follows successive face boundaries along the sight line.
 */
export function* sightLineSumConstraints(
	context: ContextExtended<string>,
	v: GridFace | GridVertex,
	count: number,
	edgeIndicators: Map<GridEdge, Arith<string>>
) {
	const { Int, SumArray, Implies, And, Not, zero } = context;

	const allowsVisibility =
		v.type === 'face'
			? (indicator: Arith<string>) => indicator.eq(0)
			: (indicator: Arith<string>) => indicator.eq(1);

	const getEdgeVar = (e: GridEdge) => edgeIndicators.get(e) ?? zero;
	const variables: Arith<string>[] = [];
	// Variables in each direction representing the number of straight-line vertices or faces visible from this position,
	// including the starting vertex or face.
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

	// The RHS of this fixes the fact that we overcounted the starting vertex or face (we counted it once for each direction).
	yield SumArray(variables).eq(count + variables.length - 1);
}

/**
 * Utility functions for defining constraints on a Cartesian grid in terms of nonnegative edge values.
 */
export interface CartesianGridConstraintUtils {
	/** Constraints and utility functions on edge values used to construct the utils */
	edges: {
		/**
		 * @returns The edge value variable, or an always-zero variable if the edge is out-of-bounds.
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
	};
	/**
	 * Masyu constraints on edge variables used to construct the utils.
	 */
	masyu: MasyuConstraints;
	/**
	 * Shingoki constraints on edge variables used to construct the utils.
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
	context: ContextExtended<string>,
	grid: CartesianGridGraph,
	edgeIndicators: ForceGetMap<GridEdge, Arith<string>>
): CartesianGridConstraintUtils {
	const { And, Or, zero } = context;
	const getEdgeVar = (edge: GridEdge) => edgeIndicators.get(edge) ?? zero;
	const getEdgeVarFromEndpoints = (a: GridVertex, b: GridVertex) => {
		const edge = grid.getEdge(a, b);
		return getEdgeVar(edge);
	};

	// Some predicates that are helpful for defining constraints related to pearl colors.
	const goesVerticallyThrough = (v: GridVertex) =>
		And(
			getEdgeVarFromEndpoints(v, v.up).gt(0),
			getEdgeVarFromEndpoints(v, v.down).gt(0)
		);

	const goesHorizontallyThrough = (v: GridVertex) =>
		And(
			getEdgeVarFromEndpoints(v, v.left).gt(0),
			getEdgeVarFromEndpoints(v, v.right).gt(0)
		);

	// Whether one of the horizontal edges adjacent to the vertex is used.
	const hasHorizontalEdge = (v: GridVertex) =>
		Or(
			getEdgeVarFromEndpoints(v, v.left).gt(0),
			getEdgeVarFromEndpoints(v, v.right).gt(0)
		);

	// Whether one of the vertical edges adjacent to the vertex is used.
	const hasVerticalEdge = (v: GridVertex) =>
		Or(
			getEdgeVarFromEndpoints(v, v.up).gt(0),
			getEdgeVarFromEndpoints(v, v.down).gt(0)
		);

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
		},
		masyu,
		shingoki,
	};
}

function createGraphConstraintUtils<
	TConcrete extends ConcreteGraphTypes<TConcrete>,
	Name extends string
>(
	context: Omit<ContextExtended<Name>, 'graphConstraints'>,
	grid: PlanarGraph<TConcrete>
): GraphConstraintExtensions<TConcrete, Name> {
	const { SumArray } = context;
	const degree = (
		v: TConcrete['vertex'],
		map: ForceGetMap<TConcrete['edge'], Arith<Name>>
	) => SumArray(Array.from(v.incidentEdges(), (e) => map.forceGet(e)));

	const inDegree = (
		v: TConcrete['vertex'],
		map: ForceGetMap<TConcrete['directedEdge'], Arith<Name>>
	) => SumArray(Array.from(v.incomingEdges(), (e) => map.forceGet(e)));

	const outDegree = (
		v: TConcrete['vertex'],
		map: ForceGetMap<TConcrete['directedEdge'], Arith<Name>>
	) => SumArray(Array.from(v.outgoingEdges(), (e) => map.forceGet(e)));

	const treeStructureVariables = () => {
		const vertexToId = createForceGetMap<TConcrete['vertex'], number>(
			Array.from(grid.vertices(), (v, i) => [v, i])
		);
		const max = vertexToId.size;

		const { solver, Not, And, If, Implies } = context;
		const edgeIndicators = context.indicators(grid.directedEdges(), {
			name: 'edgeIndicators',
		});
		// Number of vertices in the subtree rooted at each vertex.
		const subtreeSizes = context.ints(grid.vertices(), {
			min: 1,
			max,
			name: 'rootedSubtreeSize',
		});
		// Maps each vertex to its assigned root.
		const rootAssignments = context.ints(grid.vertices(), {
			min: 0,
			max,
			name: 'rootOf',
		});

		// Enforce the indicator variables form a tree.
		for (const edge of grid.directedEdges()) {
			// At most one of an edge and its inversion can be enabled.
			solver.add(
				Not(
					And(
						...[edge, edge.invert()].map((e) =>
							edgeIndicators.forceGet(e).eq(1)
						)
					)
				)
			);

			solver.add(inDegree(edge.to, edgeIndicators).le(1));
		}

		for (const vertex of grid.vertices()) {
			// Enforce subtree counts correctly represent the number of vertices in the subtree rooted at this vertex.
			solver.add(
				subtreeSizes.forceGet(vertex).eq(
					SumArray(
						Array.from(vertex.outgoingEdges(), (e) => {
							return If(
								edgeIndicators.forceGet(e).eq(1),
								subtreeSizes.forceGet(e.to),
								0
							);
						})
					).add(1)
				)
			);
		}

		for (const vertex of grid.vertices()) {
			const vertexIndex = vertexToId.forceGet(vertex);
			solver.add(
				// Each root vertex is identified by its flattened index.
				Implies(
					inDegree(vertex, edgeIndicators).eq(0),
					rootAssignments.forceGet(vertex).eq(vertexIndex)
				),
				// Use the lowest possible index for each root. This is not a necessary constraint for correctness, but it
				// vastly reduces the search space and is necessary in practice.
				rootAssignments.forceGet(vertex).le(vertexIndex)
			);
		}

		for (const edge of grid.directedEdges()) {
			const fromAssignment = rootAssignments.forceGet(edge.from);
			const toAssignment = rootAssignments.forceGet(edge.to);
			solver.add(
				// All vertices that are part of the same tree must be assigned the same unique root.
				Implies(
					edgeIndicators.forceGet(edge).eq(1),
					fromAssignment.eq(toAssignment)
				)
			);
		}

		return { edgeIndicators, subtreeSizes, rootAssignments };
	};

	return {
		degree,
		inDegree,
		outDegree,
		treeStructureVariables,
	};
}

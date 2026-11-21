import { CartesianCoord, CartesianGrid, Edge, Vertex } from './grid/index.js';
import type { Arith, Context, Model, Solver } from './z3.js';
import {
	EdgeIndicatorPuzzleProps,
	EdgeIndicatorPuzzle,
	EdgeIndicatorRenderOptions,
} from './edge-indicator-puzzle.js';
import { oob } from './utils.js';

export interface MasyuPuzzleProps extends EdgeIndicatorPuzzleProps {
	pearls: ConstructionPearl[];
	renderOptions?: PearlRenderOptions;
}

interface Pearl {
	coord: Vertex;
	color: 'black' | 'white';
}

export interface PearlRenderOptions extends EdgeIndicatorRenderOptions {
	black: string;
	white: string;
}

/**
 * @remarks
 * Used only prior to constructing a {@link MasyuPuzzle}.
 *
 * {@link Pearl} is more convenient to work with once the grid has been constructed.
 */
interface ConstructionPearl {
	coord: CartesianCoord;
	color: 'black' | 'white';
}

export type EdgeIndicator = [Edge, 1 | 0];

export class MasyuPuzzle extends EdgeIndicatorPuzzle<'black' | 'white'> {
	/**
	 * Note: the indexing model assumes pearls are placed go-style.
	 *
	 * If input assume chess/checkers style and indexes accordingly, this does not actually cause a problem (since
	 * it just offsets the grid).
	 *
	 * The solver code works in terms of the natural vertex/edge graph representation when using go style indexing,
	 * which is why having the appropriate mental model is relevant.
	 */
	#pearls: Pearl[];

	#renderChars: PearlRenderOptions;

	constructor(props: MasyuPuzzleProps) {
		super(props);
		this.#renderChars = props.renderOptions ?? {
			vertex: '·',
			horizontal: '━',
			vertical: '┃',
			black: '⬤',
			white: '◯',
		};

		this.#pearls = props.pearls.map((p) => ({
			coord: this.grid.getVertex(p.coord),
			color: p.color,
		}));
		for (const pearl of this.#pearls) {
			if (!this.grid.inBounds(pearl.coord.coord)) {
				throw new Error(`Pearl at ${pearl.coord} is out of bounds`);
			}
			this.grid.set(pearl.coord.coord, pearl.color);
		}
	}

	public static fromTextGrid(
		text: string,
		renderOptions?: PearlRenderOptions
	) {
		const lines = text.trim().split('\n');
		const height = lines.length;
		const width = lines[0].length;
		const pearls: ConstructionPearl[] = [];
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const char = lines[y][x];
				if (['B', 'b'].includes(char)) {
					pearls.push({ coord: [x, y], color: 'black' });
				} else if (['W', 'w'].includes(char)) {
					pearls.push({ coord: [x, y], color: 'white' });
				}
			}
		}
		return new MasyuPuzzle({ width, height, pearls, renderOptions });
	}

	public getCell(coord: CartesianCoord): 'black' | 'white' | 'empty' {
		return this.grid.get(coord);
	}

	public override addConstraints(
		context: Context<string>,
		solver: Solver<string>
	): Map<Edge, Arith<string>> {
		const edges = [...this.grid.edges()];

		// You will want:

		// A variable for each edge, 0 or 1 valued depending on whether it is part of the solution path
		// ...except for instead of 0 or 1, maybe want to use connectivity constraint (so -1 or postive integer)

		// Then for each pearl, you will want to enforce the Masyu constraints:
		// - For black pearls, the path must go straight through and must turn immediately before and after.
		// - For white pearls, the path must turn at the pearl and must go straight for at least one edge before and after.

		// The connectivity constraints require looking up variables for edges adjacent to a given edge, as well as adding the 0-or-2 degree (edges adjacent to a vertex) to guarantee a loop.
		// The pearl constraints will require looking up variables for edges adjacent to other edges
		// Should all be doable by mapping the str representation of an edge to their corresponding variable pretty simply.

		const { Int, And, Or, Implies, Sum } = context;

		const edgeVariables = this.createEdgeVariables(context);
		const bound = (a: Arith<string>, b: number, c: number) =>
			And(a.ge(b), a.le(c));

		for (const edge of edges) {
			const edgeVar = edgeVariables.get(edge) ?? oob(edge);
			solver.add(bound(edgeVar, 0, 1));
		}

		// Can be used for constraints that should never be satisfied as well as to represent "out-of-bounds" edges.
		const zeroVar = Int.const('zero');
		solver.add(zeroVar.eq(0));

		const getEdgeVar = (a: Vertex, b: Vertex) => {
			const edge = this.grid.getEdge(a, b);
			return edgeVariables.get(edge) ?? zeroVar;
		};

		// Some predicates that are helpful for defining constraints related to pearl colors.
		const goesVerticallyThrough = (v: Vertex) =>
			And(getEdgeVar(v, v.up).eq(1), getEdgeVar(v, v.down).eq(1));

		const goesHorizontallyThrough = (v: Vertex) =>
			And(getEdgeVar(v, v.left).eq(1), getEdgeVar(v, v.right).eq(1));

		// Whether one of the horizontal edges adjacent to the vertex is used.
		const hasHorizontalEdge = (v: Vertex) =>
			Or(getEdgeVar(v, v.left).eq(1), getEdgeVar(v, v.right).eq(1));

		// Whether one of the vertical edges adjacent to the vertex is used.
		const hasVerticalEdge = (v: Vertex) =>
			Or(getEdgeVar(v, v.up).eq(1), getEdgeVar(v, v.down).eq(1));

		for (const pearl of this.#pearls) {
			const { coord, color } = pearl;
			const { up, down, left, right } = coord;
			if (color === 'black') {
				const leftUsed = goesHorizontallyThrough(left);
				const rightUsed = goesHorizontallyThrough(right);
				const downUsed = goesVerticallyThrough(down);
				const upUsed = goesVerticallyThrough(up);
				solver.add(
					Or(
						And(downUsed, Or(leftUsed, rightUsed)),
						And(upUsed, Or(leftUsed, rightUsed))
					)
				);
			} else if (color === 'white') {
				solver.add(
					Or(
						And(
							goesVerticallyThrough(coord),
							Or(hasHorizontalEdge(up), hasHorizontalEdge(down))
						),
						And(
							goesHorizontallyThrough(coord),
							Or(hasVerticalEdge(left), hasVerticalEdge(right))
						)
					)
				);
			}
		}

		{
			solver.add(...connectedConstraints(edgeVariables, context));

			for (const vertex of this.grid.vertices()) {
				const { up, down, left, right } = vertex;
				const degree = Sum(
					getEdgeVar(vertex, up),
					getEdgeVar(vertex, down),
					getEdgeVar(vertex, left),
					getEdgeVar(vertex, right)
				);

				solver.add(Or(degree.eq(0), degree.eq(2)));
			}
		}

		return edgeVariables;
	}

	public override parseAssignment(assignment: string): 0 | 1 {
		const value = Number(assignment);
		if (value !== 0 && value !== 1) {
			throw new Error(`Invalid assignment value: ${value}`);
		}
		return value;
	}

	public override renderT(t: 'black' | 'white'): string {
		return this.#renderChars[t];
	}
}

interface HasNeighbors<T extends HasNeighbors<T>> {
	neighbors(options: { includeOutOfBounds: boolean }): Iterable<T>;
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
function* connectedConstraints<T extends HasNeighbors<T>>(
	indicatorVariables: Map<HasNeighbors<T>, Arith<string>>,
	context: Context<string>
) {
	const vertices = Array.from(indicatorVariables.keys());
	const connectivityVariables = new Map<HasNeighbors<T>, Arith<string>>();

	const bound = (a: Arith<string>, b: number, c: number) =>
		And(a.ge(b), a.le(c));

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

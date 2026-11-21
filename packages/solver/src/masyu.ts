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
		const connectivityVariables = this.createEdgeVariables(
			context,
			'connectivity_'
		);
		const bound = (a: Arith<string>, b: number, c: number) =>
			And(a.ge(b), a.le(c));

		for (const edge of edges) {
			const edgeVar = edgeVariables.get(edge) ?? oob(edge);
			const connectivityVar =
				connectivityVariables.get(edge) ?? oob(edge);

			solver.add(
				bound(edgeVar, 0, 1),
				bound(connectivityVar, -1, this.width * this.height),
				Implies(edgeVar.eq(0), connectivityVar.eq(-1)),
				Implies(edgeVar.eq(1), connectivityVar.ge(1))
			);
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

		// This constraint enforces connectivity.
		// Intuitively, this constraint can be satisfied on a connected graph by assigning an arbitrary vertex 1 and cascading outwards
		// with increasing values via BFS or something like that.
		// See this paper for more details:
		// https://www.cs.ru.nl/bachelors-theses/2021/Gerhard_van_der_Knijff___1006946___Solving_and_generating_puzzles_with_a_connectivity_constraint.pdf
		{
			for (const edge of edges) {
				const edgeVar = edgeVariables.get(edge) ?? oob(edge);
				const connectivityEdgeVar =
					connectivityVariables.get(edge) ?? oob(edge);
				solver.add(Implies(edgeVar.eq(1), connectivityEdgeVar.ge(0)));
			}

			for (const edge of edges) {
				const edgeVar = connectivityVariables.get(edge) ?? oob(edge);

				const adjacentEdges = Array.from(
					edge.neighbors({ includeOutOfBounds: false })
				).map((e) => connectivityVariables.get(e) ?? oob(e));

				solver.add(
					Or(
						edgeVar.eq(-1),
						edgeVar.eq(1),
						...adjacentEdges.map((e) =>
							And(e.le(edgeVar), e.neq(-1))
						)
					)
				);
			}

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

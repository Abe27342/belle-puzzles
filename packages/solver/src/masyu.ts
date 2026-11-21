import { CartesianCoord, CartesianGrid, Edge, Vertex } from './grid/index.js';
import type { Arith, Context, Model, Solver } from './z3.js';
import { Puzzle } from './puzzle.js';
import { oob } from './utils.js';

const move = (
	coord: CartesianCoord,
	direction: CartesianCoord
): CartesianCoord => [coord[0] + direction[0], coord[1] + direction[1]];

const down = (coord: CartesianCoord) => move(coord, [0, 1]);
const up = (coord: CartesianCoord) => move(coord, [0, -1]);
const left = (coord: CartesianCoord) => move(coord, [-1, 0]);
const right = (coord: CartesianCoord) => move(coord, [1, 0]);

interface MasyuPuzzleProps {
	width: number;
	height: number;
	pearls: ConstructionPearl[];
}

interface Pearl {
	coord: Vertex;
	color: 'black' | 'white';
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

export class MasyuPuzzle extends Puzzle<EdgeIndicator[]> {
	#width: number;
	#height: number;
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

	#grid: CartesianGrid<'black' | 'white' | 'empty'>;

	public get width() {
		return this.#width;
	}

	public get height() {
		return this.#height;
	}

	constructor(props: MasyuPuzzleProps) {
		super();
		this.#width = props.width;
		this.#height = props.height;
		this.#grid = CartesianGrid.fromDimensions(
			this.#width,
			this.#height,
			() => 'empty'
		);
		this.#pearls = props.pearls.map((p) => ({
			coord: this.#grid.getVertex(p.coord),
			color: p.color,
		}));
		for (const pearl of this.#pearls) {
			if (!this.#grid.inBounds(pearl.coord.coord)) {
				throw new Error(`Pearl at ${pearl.coord} is out of bounds`);
			}
			this.#grid.set(pearl.coord.coord, pearl.color);
		}
	}

	public static fromTextGrid(text: string) {
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
		return new MasyuPuzzle({ width, height, pearls });
	}

	public getCell(coord: CartesianCoord): 'black' | 'white' | 'empty' {
		return this.#grid.get(coord);
	}

	#edgeVariables: Map<Edge, Arith<string>> = new Map();
	public *getConstraints(
		context: Context<string>
	): Iterable<Parameters<Solver<string>['add']>[0]> {
		const edges = [...this.#grid.edges()];

		// You will want:

		// A variable for each edge, 0 or 1 valued depending on whether it is part of the solution path
		// ...except for instead of 0 or 1, maybe want to use connectivity constraint (so -1 or postive integer)

		// Then for each pearl, you will want to enforce the Masyu constraints:
		// - For black pearls, the path must go straight through and must turn immediately before and after.
		// - For white pearls, the path must turn at the pearl and must go straight for at least one edge before and after.

		// The connectivity constraints require looking up variables for edges adjacent to a given edge, as well as adding the 0-or-2 degree (edges adjacent to a vertex) to guarantee a loop.
		// The pearl constraints will require looking up variables for edges adjacent to other edges
		// Should all be doable by mapping the str representation of an edge to their corresponding variable pretty simply.

		const connectivityVariables: Record<
			/* Edge.toString() */ string,
			Arith<string>
		> = {};

		const { Int, And, Or, Implies, Sum } = context;

		this.#edgeVariables = createEdgeIndicatorVariables(this.#grid, context);

		const bound = (a: Arith<string>, b: number, c: number) =>
			And(a.ge(b), a.le(c));

		for (const edge of edges) {
			const strEdge = edge.toString();
			const edgeVar = this.#edgeVariables.get(edge) ?? oob();
			const connectivityVar = Int.const(`connectivity_${strEdge}`);
			connectivityVariables[strEdge] = connectivityVar;

			yield* [
				bound(edgeVar, 0, 1),
				bound(connectivityVar, -1, this.#width * this.#height),
				Implies(edgeVar.eq(0), connectivityVar.eq(-1)),
				Implies(edgeVar.eq(1), connectivityVar.ge(1)),
			];
		}

		// Can be used for constraints that should never be satisfied as well as to represent "out-of-bounds" edges.
		const zeroVar = Int.const('zero');
		yield zeroVar.eq(0);

		const getEdgeVar = (a: Vertex, b: Vertex) => {
			const edge = this.#grid.getEdge(a, b);
			return this.#edgeVariables.get(edge) ?? zeroVar;
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
				yield Or(
					And(downUsed, Or(leftUsed, rightUsed)),
					And(upUsed, Or(leftUsed, rightUsed))
				);
			} else if (color === 'white') {
				yield Or(
					And(
						goesVerticallyThrough(coord),
						Or(hasHorizontalEdge(up), hasHorizontalEdge(down))
					),
					And(
						goesHorizontallyThrough(coord),
						Or(hasVerticalEdge(left), hasVerticalEdge(right))
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
				const edgeVar = this.#edgeVariables.get(edge) ?? oob();
				const connectivityEdgeVar =
					connectivityVariables[edge.toString()];
				yield Implies(edgeVar.eq(1), connectivityEdgeVar.ge(0));
			}

			for (const edge of edges) {
				const edgeVar = connectivityVariables[edge.toString()];

				const adjacentEdges = Array.from(
					edge.neighbors({ includeOutOfBounds: false })
				).map((e) => connectivityVariables[e.toString()]);

				yield Or(
					edgeVar.eq(-1),
					edgeVar.eq(1),
					...adjacentEdges.map((e) => And(e.le(edgeVar), e.neq(-1)))
				);
			}

			for (const vertex of this.#grid.vertices()) {
				const { up, down, left, right } = vertex;
				const degree = Sum(
					getEdgeVar(vertex, up),
					getEdgeVar(vertex, down),
					getEdgeVar(vertex, left),
					getEdgeVar(vertex, right)
				);

				yield Or(degree.eq(0), degree.eq(2));
			}
		}
	}

	public resolveSolution(model: Model<string>): EdgeIndicator[] {
		return Array.from(this.#edgeVariables.entries(), ([edge, variable]) => {
			const presence = Number(model.eval(variable).toString());
			if (presence !== 0 && presence !== 1) {
				throw new Error(`Invalid edge presence value: ${presence}`);
			}
			return [edge, presence] as const;
		});
	}
}

export function createEdgeIndicatorVariables(
	grid: CartesianGrid<unknown>,
	context: Context<string>
): Map<Edge, Arith<string>> {
	const edgeVariables = new Map<Edge, Arith<string>>();
	for (const edge of grid.edges()) {
		edgeVariables.set(edge, context.Int.const(edge.toString()));
	}
	return edgeVariables;
}

export async function renderMasyuSolution(
	puzzle: MasyuPuzzle,
	renderChars: Record<
		'black' | 'white' | 'vertex' | 'horizontal' | 'vertical',
		string
	> = {
		black: '⬤',
		white: '◯',
		vertex: '·',
		horizontal: '━',
		vertical: '┃',
	}
): Promise<string> {
	const edgeAssignments = await puzzle.solve();
	if (typeof edgeAssignments === 'string') {
		return edgeAssignments;
	}

	const assignmentByEdge = Object.fromEntries(edgeAssignments);
	const mockGrid = CartesianGrid.fromDimensions(
		puzzle.width,
		puzzle.height,
		() => 0
	);
	let result = '';
	for (let y = 0; y < puzzle.height; y++) {
		let pearlLine = '';
		let verticalEdgeLine = '';
		for (let x = 0; x < puzzle.width; x++) {
			const current: CartesianCoord = [x, y];
			switch (puzzle.getCell(current)) {
				case 'black':
					pearlLine += renderChars.black;
					break;
				case 'white':
					pearlLine += renderChars.white;
					break;
				default:
					pearlLine += renderChars.vertex;
					break;
			}

			const rightEdge = mockGrid.getEdge(current, right(current));
			const rightEdgeAssignment = assignmentByEdge[rightEdge.toString()];
			if (rightEdgeAssignment !== undefined) {
				pearlLine +=
					rightEdgeAssignment === 1 ? renderChars.horizontal : ' ';
			}

			const downEdge = mockGrid.getEdge(current, down(current));
			const downEdgeAssignment = assignmentByEdge[downEdge.toString()];
			verticalEdgeLine +=
				downEdgeAssignment === 1 ? renderChars.vertical + ' ' : '  ';
		}

		result += pearlLine + '\n';

		if (y < puzzle.height - 1) {
			result += verticalEdgeLine + '\n';
		}
	}

	return result;
}

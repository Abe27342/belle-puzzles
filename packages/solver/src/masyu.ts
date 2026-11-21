import { CartesianCoord, CartesianGrid, Edge, Vertex } from './grid/index.js';
import { Arith, z3 } from './index.js';

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

export class MasyuPuzzle {
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

	public async solve(): Promise<string | [Edge, string][]> {
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

		const variables: Record<
			/* Edge.toString() */ string,
			Arith<string>
		> = {};

		const connectivityVariables: Record<
			/* Edge.toString() */ string,
			Arith<string>
		> = {};

		const context = new z3.Context<string>('MasyuPuzzle');

		const { Solver, Int, And, Or, Implies, Sum } = context;

		const solver = new Solver();
		const bound = (a: Arith<string>, b: number, c: number) =>
			And(a.ge(b), a.le(c));

		for (const edge of edges) {
			const strEdge = edge.toString();
			const edgeVar = Int.const(strEdge);
			solver.add(bound(edgeVar, 0, 1));
			variables[strEdge] = edgeVar;

			const connectivityVar = Int.const(`connectivity_${strEdge}`);

			connectivityVariables[strEdge] = connectivityVar;
			solver.add(bound(connectivityVar, -1, this.#width * this.#height));
			solver.add(Implies(edgeVar.eq(0), connectivityVar.eq(-1)));
			solver.add(Implies(edgeVar.eq(1), connectivityVar.ge(1)));
		}

		// Allows creating a constraint that is always false, useful for conditional constraints that should never be satisfied
		const dummyVar = Int.const('dummy');
		const never = And(dummyVar.eq(0), dummyVar.neq(0));
		const zeroVar = Int.const('zero');
		solver.add(zeroVar.eq(0));
		const neverVar = Int.const('never');
		solver.add(neverVar.eq(-42)); // xd

		const getEdgeVar = (a: Vertex, b: Vertex, defaultVar = neverVar) =>
			variables[this.#grid.getEdge(a, b).toString()] ??
			variables[this.#grid.getEdge(b, a).toString()] ??
			// Any constraint placed on an edge that does not exist will lead to a contradiction, so we use neverVar to represent such edges.
			defaultVar;

		for (const pearl of this.#pearls) {
			const { coord, color } = pearl;
			const adj = coord.oobNeighbors;
			const down1 = getEdgeVar(coord, adj.down);
			const up1 = getEdgeVar(coord, adj.up);
			const left1 = getEdgeVar(coord, adj.left);
			const right1 = getEdgeVar(coord, adj.right);
			if (color === 'black') {
				const down2 = getEdgeVar(adj.down, adj.down.oobNeighbors.down);
				const up2 = getEdgeVar(adj.up, adj.up.oobNeighbors.up);
				const left2 = getEdgeVar(adj.left, adj.left.oobNeighbors.left);
				const right2 = getEdgeVar(
					adj.right,
					adj.right.oobNeighbors.right
				);

				const leftUsed = And(left1.eq(1), left2.eq(1));
				const rightUsed = And(right1.eq(1), right2.eq(1));
				const downUsed = And(down1.eq(1), down2.eq(1));
				const upUsed = And(up1.eq(1), up2.eq(1));

				solver.add(
					Or(
						And(downUsed, Or(leftUsed, rightUsed)),
						And(upUsed, Or(leftUsed, rightUsed))
					)
				);
			} else if (color === 'white') {
				const adj = coord.oobNeighbors;
				const downLeft = getEdgeVar(
					adj.down,
					adj.down.oobNeighbors.left
				);
				const downRight = getEdgeVar(
					adj.down,
					adj.down.oobNeighbors.right
				);
				const upLeft = getEdgeVar(adj.up, adj.up.oobNeighbors.left);
				const upRight = getEdgeVar(adj.up, adj.up.oobNeighbors.right);

				const leftUp = getEdgeVar(adj.left, adj.left.oobNeighbors.up);
				const leftDown = getEdgeVar(
					adj.left,
					adj.left.oobNeighbors.down
				);
				const rightUp = getEdgeVar(
					adj.right,
					adj.right.oobNeighbors.up
				);
				const rightDown = getEdgeVar(
					adj.right,
					adj.right.oobNeighbors.down
				);

				solver.add(
					Or(
						// Line goes through pearl vertically
						And(
							down1.eq(1),
							up1.eq(1),
							Or(
								downLeft.eq(1),
								downRight.eq(1),
								upLeft.eq(1),
								upRight.eq(1)
							)
						),
						// Line goes through pearl horizontally
						And(
							left1.eq(1),
							right1.eq(1),
							Or(
								leftUp.eq(1),
								leftDown.eq(1),
								rightUp.eq(1),
								rightDown.eq(1)
							)
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
				const edgeVar = variables[edge.toString()];
				const connectivityEdgeVar =
					connectivityVariables[edge.toString()];
				solver.add(Implies(edgeVar.eq(1), connectivityEdgeVar.ge(0)));
			}

			for (const edge of edges) {
				const edgeVar = connectivityVariables[edge.toString()];

				const adjacentEdges = Array.from(edge.neighbors()).map(
					(e) => connectivityVariables[e.toString()]
				);

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

			for (const vertex of this.#grid.vertices()) {
				const adj = vertex.oobNeighbors;
				const degree = Sum(
					getEdgeVar(vertex, adj.up, zeroVar),
					getEdgeVar(vertex, adj.down, zeroVar),
					getEdgeVar(vertex, adj.left, zeroVar),
					getEdgeVar(vertex, adj.right, zeroVar)
				);
				solver.add(Or(degree.eq(0), degree.eq(2)));
			}
		}

		const result = await solver.check();
		if (result === 'sat') {
			const model = solver.model();
			const resolvedEdgeVars = edges.map((edge): [Edge, string] => [
				edge,
				model.eval(variables[edge.toString()]).toString(),
			]);

			return resolvedEdgeVars;
		}

		return result;
	}
}

export async function renderMasyuSolution(
	puzzle: MasyuPuzzle
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
					pearlLine += '⬤';
					break;
				case 'white':
					pearlLine += '◯';
					break;
				default:
					pearlLine += '·';
					break;
			}

			const rightEdge = mockGrid.getEdge(current, right(current));
			const rightEdgeAssignment = assignmentByEdge[rightEdge.toString()];
			if (rightEdgeAssignment !== undefined) {
				pearlLine += rightEdgeAssignment === '1' ? '━' : ' ';
			}

			const downEdge = mockGrid.getEdge(current, down(current));
			const downEdgeAssignment = assignmentByEdge[downEdge.toString()];
			verticalEdgeLine += downEdgeAssignment === '1' ? '┃ ' : '  ';
		}

		result += pearlLine + '\n';

		if (y < puzzle.height - 1) {
			result += verticalEdgeLine + '\n';
		}
	}

	return result;
}

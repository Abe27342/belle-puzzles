import { Arith, z3 } from './index.js';

function* mapIterable<T, O>(
	iterable: Iterable<T>,
	fn: (t: T) => O
): Iterable<O> {
	for (const item of iterable) {
		yield fn(item);
	}
}

interface Grid<TCoord, T> {
	get(coord: TCoord): T;

	set(coord: TCoord, value: T): void;

	neighbors(coord: TCoord): Iterable<TCoord>;

	cells(): Iterable<[TCoord, T]>;

	cellValues(): Iterable<T>;
}

type RectangularCoord = [x: number, y: number];

class RectangularGrid<T> implements Grid<RectangularCoord, T> {
	#grid: T[][];
	public readonly width: number;
	public readonly height: number;

	constructor(grid: T[][]) {
		this.height = grid.length;
		// Copy for safety
		this.#grid = [...grid].map((row) => [...row]);
		this.width = grid[0]?.length ?? 0;

		for (const row of this.#grid) {
			if (row.length !== this.width) {
				throw new Error('All rows must have the same length');
			}
		}
	}

	public static fromDimensions<T>(
		width: number,
		height: number,
		filledValue: () => T
	): RectangularGrid<T> {
		const grid: T[][] = Array.from({ length: height }, () =>
			Array.from({ length: width }, () => filledValue())
		);
		return new RectangularGrid(grid);
	}

	#validateCoord(coord: RectangularCoord): void {
		const [x, y] = coord;
		if (y < 0 || y >= this.height || x < 0 || x >= this.width) {
			throw new RangeError('Coordinate out of bounds');
		}
	}

	public set(coord: RectangularCoord, value: T): void {
		this.#validateCoord(coord);
		const [x, y] = coord;
		this.#grid[y][x] = value;
	}

	public get(coord: RectangularCoord): T {
		this.#validateCoord(coord);
		const [x, y] = coord;
		return this.#grid[y][x];
	}

	static #up = [0, -1];
	static #down = [0, 1];
	static #left = [-1, 0];
	static #right = [1, 0];

	static #deltas = [
		RectangularGrid.#up,
		RectangularGrid.#down,
		RectangularGrid.#left,
		RectangularGrid.#right,
	];

	public neighbors(coord: RectangularCoord): RectangularCoord[] {
		const [x, y] = coord;
		return RectangularGrid.#deltas
			.map(([dx, dy]) => [x + dx, y + dy] as RectangularCoord)
			.filter(
				([nx, ny]) =>
					nx >= 0 && nx < this.width && ny >= 0 && ny < this.height
			);
	}

	public cells(): Iterable<[RectangularCoord, T]> {
		const result: [RectangularCoord, T][] = [];
		for (let y = 0; y < this.height; y++) {
			for (let x = 0; x < this.width; x++) {
				result.push([[x, y], this.#grid[y][x]]);
			}
		}
		return result;
	}

	public cellValues(): Iterable<T> {
		return this.#grid.flat();
	}
}

const compareCoords = (start: RectangularCoord, end: RectangularCoord) => {
	if (start[0] < end[0]) return -1;
	if (start[0] > end[0]) return 1;
	if (start[1] < end[1]) return -1;
	if (start[1] > end[1]) return 1;
	return 0;
};

const equalCoord = (a: RectangularCoord, b: RectangularCoord) =>
	a[0] === b[0] && a[1] === b[1];

const move = (
	coord: RectangularCoord,
	direction: RectangularCoord
): RectangularCoord => [coord[0] + direction[0], coord[1] + direction[1]];

const down = (coord: RectangularCoord) => move(coord, [0, 1]);
const up = (coord: RectangularCoord) => move(coord, [0, -1]);
const left = (coord: RectangularCoord) => move(coord, [-1, 0]);
const right = (coord: RectangularCoord) => move(coord, [1, 0]);

class Edge {
	#start: RectangularCoord;
	#end: RectangularCoord;
	#grid: RectangularGrid<unknown>;

	constructor(
		start: RectangularCoord,
		end: RectangularCoord,
		grid: RectangularGrid<unknown>
	) {
		if (compareCoords(start, end) < 0) {
			this.#start = start;
			this.#end = end;
		} else {
			this.#start = end;
			this.#end = start;
		}
		const dx = Math.abs(this.#end[0] - this.#start[0]);
		const dy = Math.abs(this.#end[1] - this.#start[1]);
		if ((dx !== 0 && dy !== 0) || (dx !== 1 && dy !== 1)) {
			throw new Error('Invalid edge');
		}
		this.#grid = grid;
	}

	public toString(): string {
		return `(${JSON.stringify(this.#start)}, ${JSON.stringify(this.#end)})`;
	}

	public overlaps(other: Edge): boolean {
		return (
			equalCoord(this.#start, other.#start) ||
			equalCoord(this.#start, other.#end) ||
			equalCoord(this.#end, other.#start) ||
			equalCoord(this.#end, other.#end)
		);
	}

	public *neighbors(): Iterable<Edge> {
		const { width, height } = this.#grid;
		const yieldNeighbors = function* (
			coord: RectangularCoord
		): Iterable<RectangularCoord> {
			for (const direction of [
				[0, 1],
				[0, -1],
				[1, 0],
				[-1, 0],
			]) {
				const [dx, dy] = direction;
				const nx = coord[0] + dx;
				const ny = coord[1] + dy;
				if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
					yield [nx, ny];
				}
			}
		};

		for (const neighbor of yieldNeighbors(this.#start)) {
			if (!equalCoord(neighbor, this.#end)) {
				yield new Edge(neighbor, this.#start, this.#grid);
			}
		}
		for (const neighbor of yieldNeighbors(this.#end)) {
			if (!equalCoord(neighbor, this.#start)) {
				yield new Edge(neighbor, this.#end, this.#grid);
			}
		}
	}
}

interface Renderer<TCoord, T> {
	render(grid: Grid<TCoord, T>): void;
}

class RectangularGridPrintRenderer<T> implements Renderer<RectangularCoord, T> {
	#renderT: (t: T) => string;

	constructor(renderT: (t: T) => string = (t) => `${t}`) {
		this.#renderT = renderT;
	}

	public render(grid: Grid<RectangularCoord, T>): void {
		if (!(grid instanceof RectangularGrid)) {
			throw new Error('Grid must be a RectangularGrid');
		}

		const padLength = Math.max(
			...mapIterable(grid.cellValues(), (t) => this.#renderT(t).length)
		);

		for (let y = 0; y < grid.height; y++) {
			let row = '';
			for (let x = 0; x < grid.width; x++) {
				if (padLength > 1) {
					row += '|';
				}
				row += this.#padLeft(
					this.#renderT(grid.get([x, y])),
					padLength
				);
			}
			console.log(row);
		}
	}

	#padLeft(str: string, length: number): string {
		return str.padStart(length, ' ');
	}
}

const renderer = new RectangularGridPrintRenderer();
const grid = new RectangularGrid([
	[1, 2, 3],
	[4, 15, 6],
	[7, 8, 9],
]);
renderer.render(grid);
const grid2 = new RectangularGrid([
	[1, 2, 3],
	[4, 5, 6],
	[7, 8, 9],
]);
renderer.render(grid2);

interface MasyuPuzzleProps {
	width: number;
	height: number;
	pearls: Pearl[];
}

interface Pearl {
	coord: RectangularCoord;
	color: 'black' | 'white';
}

class MasyuPuzzle {
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

	#grid: RectangularGrid<'black' | 'white' | 'empty'>;

	public get width() {
		return this.#width;
	}

	public get height() {
		return this.#height;
	}

	constructor(props: MasyuPuzzleProps) {
		this.#width = props.width;
		this.#height = props.height;
		this.#pearls = props.pearls;
		this.#grid = RectangularGrid.fromDimensions(
			this.#width,
			this.#height,
			() => 'empty'
		);
		for (const pearl of this.#pearls) {
			const [x, y] = pearl.coord;
			if (x < 0 || x >= this.#width || y < 0 || y >= this.#height) {
				throw new Error(`Pearl at ${x},${y} is out of bounds`);
			}
			this.#grid.set([x, y], pearl.color);
		}
	}

	public static fromTextGrid(text: string) {
		const lines = text.trim().split('\n');
		const height = lines.length;
		const width = lines[0].length;
		const pearls: Pearl[] = [];
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

	public getCell(coord: RectangularCoord): 'black' | 'white' | 'empty' {
		return this.#grid.get(coord);
	}

	public async solve(): Promise<string | [Edge, string][]> {
		const edges: Edge[] = [];
		for (let x = 0; x < this.#width; x++) {
			for (let y = 0; y < this.#height; y++) {
				if (x < this.#width - 1) {
					edges.push(new Edge([x, y], [x + 1, y], this.#grid));
				}
				if (y < this.#height - 1) {
					edges.push(new Edge([x, y], [x, y + 1], this.#grid));
				}
			}
		}

		const stringifyCoord = (coord: RectangularCoord) =>
			JSON.stringify(coord);

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

		const { Solver, solve, Int, And, Or, Implies, Sum } = context;

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

		const getEdgeVar = (
			a: RectangularCoord,
			b: RectangularCoord,
			defaultVar = neverVar
		) =>
			variables[new Edge(a, b, this.#grid).toString()] ??
			variables[new Edge(b, a, this.#grid).toString()] ??
			// Any constraint placed on an edge that does not exist will lead to a contradiction, so we use neverVar to represent such edges.
			defaultVar;

		for (const pearl of this.#pearls) {
			const { coord, color } = pearl;
			const down1 = getEdgeVar(coord, down(coord));
			const up1 = getEdgeVar(coord, up(coord));
			const left1 = getEdgeVar(coord, left(coord));
			const right1 = getEdgeVar(coord, right(coord));
			if (color === 'black') {
				const down2 = getEdgeVar(down(coord), down(down(coord)));
				const up2 = getEdgeVar(up(coord), up(up(coord)));
				const left2 = getEdgeVar(left(coord), left(left(coord)));
				const right2 = getEdgeVar(right(coord), right(right(coord)));

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
				const downLeft = getEdgeVar(down(coord), left(down(coord)));
				const downRight = getEdgeVar(down(coord), right(down(coord)));
				const upLeft = getEdgeVar(up(coord), left(up(coord)));
				const upRight = getEdgeVar(up(coord), right(up(coord)));

				const leftUp = getEdgeVar(left(coord), up(left(coord)));
				const leftDown = getEdgeVar(left(coord), down(left(coord)));
				const rightUp = getEdgeVar(right(coord), up(right(coord)));
				const rightDown = getEdgeVar(right(coord), down(right(coord)));

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

			for (const [coord] of this.#grid.cells()) {
				const degree = Sum(
					getEdgeVar(coord, up(coord), zeroVar),
					getEdgeVar(coord, down(coord), zeroVar),
					getEdgeVar(coord, left(coord), zeroVar),
					getEdgeVar(coord, right(coord), zeroVar)
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

let puzzle = new MasyuPuzzle({
	width: 3,
	height: 3,
	pearls: [
		{ coord: [0, 0], color: 'black' },
		{ coord: [2, 2], color: 'black' },
	],
});

puzzle = MasyuPuzzle.fromTextGrid(`
B.W...
..W..W
....B.
.B....
......
....B.
`);

// this is actually a shingoki
// https://puzzling.stackexchange.com/questions/104786/shingoki-an-exploration-of-unicode
// puzzle = MasyuPuzzle.fromTextGrid(`
// ..........B
// ...WBW.....
// B....B.BB..
// ..W..B...W.
// W..B......B
// ..BB.B....B
// .W..B..W...
// ....BBB.W..
// ....W......
// ....B...BBW
// B..........
// `);

const result = await puzzle.solve();
console.log(JSON.stringify(result));

async function renderMasyuSolution(puzzle: MasyuPuzzle): Promise<string> {
	const edgeAssignments = await puzzle.solve();
	if (typeof edgeAssignments === 'string') {
		return edgeAssignments;
	}

	const assignmentByEdge = Object.fromEntries(edgeAssignments);
	const mockGrid = RectangularGrid.fromDimensions(
		puzzle.width,
		puzzle.height,
		() => 0
	);
	let result = '';
	for (let y = 0; y < puzzle.height; y++) {
		let pearlLine = '';
		let verticalEdgeLine = '';
		for (let x = 0; x < puzzle.width; x++) {
			const current: RectangularCoord = [x, y];
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

			const rightEdge = new Edge(current, right(current), mockGrid);
			const rightEdgeAssignment = assignmentByEdge[rightEdge.toString()];
			if (rightEdgeAssignment !== undefined) {
				pearlLine += rightEdgeAssignment === '1' ? '━' : ' ';
			}

			const downEdge = new Edge(current, down(current), mockGrid);
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

console.log(await renderMasyuSolution(puzzle));

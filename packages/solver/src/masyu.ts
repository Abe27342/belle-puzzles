import { CartesianCoord, Edge, Vertex } from './grid/index.js';
import type { Arith, Context, Solver } from './z3.js';
import {
	EdgeIndicatorPuzzleProps,
	EdgeIndicatorPuzzle,
	EdgeIndicatorRenderOptions,
} from './edge-indicator-puzzle.js';
import { connectedLoopConstraints } from './constraint-utils.js';

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
		const { Int, And, Or } = context;
		const edgeVariables = this.createEdgeIndicatorVariables(
			context,
			solver
		);

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

		solver.add(...connectedLoopConstraints(edgeVariables, context));
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

import { CartesianCoord, GridEdge, GridVertex } from './grid/index.js';
import type { Arith, Context, Solver } from './z3.js';
import {
	EdgeIndicatorPuzzleProps,
	EdgeIndicatorPuzzle,
	EdgeIndicatorRenderOptions,
} from './edge-indicator-puzzle.js';
import {
	connectedLoopConstraints,
	createCartesianGridConstraintUtils,
	createConstraintExtensions,
} from './constraint-utils.js';

export interface ShingokiPuzzleProps extends EdgeIndicatorPuzzleProps {
	pearls: ConstructionPearl[];
	renderOptions?: PearlRenderOptions;
}

interface Pearl {
	coord: GridVertex;
	color: 'black' | 'white';
	length: number;
}

export interface PearlRenderOptions extends EdgeIndicatorRenderOptions {
	black: string;
	white: string;
}

/**
 * Textual representation of a Shingoki puzzle grid.
 * `colors` contains the color of each cell ('B' for black, 'W' for white, '.' for empty).
 * `lengths` contains the length of each pearl at the corresponding position.
 *
 * The parser does not currently support multi-digit lengths for pearls.
 */
export interface ShingokiTextGrids {
	colors: string;
	lengths: string;
}

/**
 * @remarks
 * Used only prior to constructing a {@link ShingokiPuzzle}.
 *
 * {@link Pearl} is more convenient to work with once the grid has been constructed.
 */
interface ConstructionPearl {
	coord: CartesianCoord;
	length: number;
	color: 'black' | 'white';
}

export class ShingokiPuzzle extends EdgeIndicatorPuzzle<'black' | 'white'> {
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

	constructor(props: ShingokiPuzzleProps) {
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
			length: p.length,
		}));
		for (const pearl of this.#pearls) {
			if (!this.grid.inBounds(pearl.coord.coord)) {
				throw new Error(`Pearl at ${pearl.coord} is out of bounds`);
			}
			this.grid.set(pearl.coord.coord, pearl.color);
		}
	}

	public static fromTextGrids(
		grids: ShingokiTextGrids,
		renderOptions?: PearlRenderOptions
	) {
		const { colors, lengths } = grids;
		const colorsLines = colors.trim().split('\n');
		const lengthsLines = lengths.trim().split('\n');
		const height = colorsLines.length;
		const width = colorsLines[0].length;

		if (colorsLines.length !== lengthsLines.length) {
			throw new Error(
				`Colors and lengths grids must have the same number of lines`
			);
		}

		if (
			colorsLines.some(
				(line, index) => line.length !== lengthsLines[index].length
			)
		) {
			throw new Error(
				`Colors and lengths grids must have the same number of columns in each line`
			);
		}

		const pearls: ConstructionPearl[] = [];
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const char = colorsLines[y][x];
				if (['B', 'b'].includes(char)) {
					const length = Number.parseInt(lengthsLines[y][x]);
					if (Number.isNaN(length)) {
						throw new Error(`Invalid length at ${x},${y}`);
					}
					pearls.push({ coord: [x, y], color: 'black', length });
				} else if (['W', 'w'].includes(char)) {
					const length = Number.parseInt(lengthsLines[y][x]);
					if (Number.isNaN(length)) {
						throw new Error(`Invalid length at ${x},${y}`);
					}
					pearls.push({ coord: [x, y], color: 'white', length });
				} else {
					if (lengthsLines[y][x] !== '.') {
						throw new Error(`Grids do not match at ${x},${y}`);
					}
				}
			}
		}
		return new ShingokiPuzzle({ width, height, pearls, renderOptions });
	}

	public getCell(coord: CartesianCoord): 'black' | 'white' | 'empty' {
		return this.grid.get(coord);
	}

	public override addConstraints(
		context: Context<string>,
		solver: Solver<string>
	): Map<GridEdge, Arith<string>> {
		const edgeVariables = this.createEdgeIndicatorVariables(
			context,
			solver
		);

		const gridUtils = createCartesianGridConstraintUtils(
			context,
			solver,
			this.grid,
			edgeVariables
		);

		const { bound } = createConstraintExtensions(context);

		const { Int, And, Sum, Implies } = context;

		for (const pearl of this.#pearls) {
			const { coord } = pearl;
			// Variables in each direction representing the number of straight-line steps taken from this pearl before turning.
			const up = Int.const(`${coord}_up`);
			const down = Int.const(`${coord}_down`);
			const left = Int.const(`${coord}_left`);
			const right = Int.const(`${coord}_right`);
			const dirMap = {
				up,
				down,
				left,
				right,
			};

			for (const variable of [up, down, left, right]) {
				// -1 here is correct because of closed loop constraint (if it took all the length,
				// it would be a dead end)
				solver.add(bound(variable, 0, pearl.length - 1));
			}

			solver.add(Sum(up, down, left, right).eq(pearl.length));

			// Bind these variables to the indicator variables.
			for (const direction of ['up', 'down', 'left', 'right'] as const) {
				const lengthVariable = dirMap[direction];
				for (
					let stepsTaken = 0;
					stepsTaken < pearl.length;
					stepsTaken++
				) {
					const relevantIndicators = Array.from(
						gridUtils.edges.directionalRun(
							coord,
							direction,
							stepsTaken + 1
						)
					);
					const [zeroEdge] = relevantIndicators.splice(-1);
					const oneEdges = relevantIndicators;
					solver.add(
						Implies(
							lengthVariable.eq(stepsTaken),
							And(...oneEdges.map((e) => e.eq(1)), zeroEdge.eq(0))
						)
					);
				}
			}
		}

		for (const { color, coord } of this.#pearls) {
			switch (color) {
				case 'black':
					solver.add(gridUtils.shingoki.blackPearl(coord));
					break;
				case 'white':
					solver.add(gridUtils.shingoki.whitePearl(coord));
					break;
			}
		}

		// Pick an arbitrary pearl to use for the minimalEnabledVariables.
		const { coord } = this.#pearls[0];
		solver.add(
			...connectedLoopConstraints(
				edgeVariables,
				coord.incidentEdges(),
				context
			)
		);
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

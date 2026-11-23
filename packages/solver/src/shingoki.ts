import { CartesianCoord, GridEdge, GridVertex } from './graph/index.js';
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
	sightLineSumConstraints,
} from './constraint-utils.js';
import {
	isEmptyGridCharacter,
	parseDigit,
	parsePearlColor,
	parseTextGrids,
} from './text-grid.js';
import type { TextGridVisitor } from './text-grid.js';

export interface ShingokiPuzzleProps extends EdgeIndicatorPuzzleProps {
	pearls: ConstructionPearl[];
	renderOptions?: PearlRenderOptions;
}

interface Pearl {
	vertex: GridVertex;
	color: 'black' | 'white';
	length: number;
}

export interface PearlRenderOptions extends EdgeIndicatorRenderOptions {
	black: string;
	white: string;
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

export class ShingokiPuzzle extends EdgeIndicatorPuzzle<
	'black' | 'white',
	never
> {
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
			vertex: this.grid.getVertex(p.coord),
			color: p.color,
			length: p.length,
		}));
		for (const pearl of this.#pearls) {
			if (!pearl.vertex.isInBounds()) {
				throw new Error(`Pearl at ${pearl.vertex} is out of bounds`);
			}
			this.vertexContents.set(pearl.vertex.coord, pearl.color);
		}
	}

	/**
	 * @param text Text representation of the Shingoki puzzle grid.
	 * This should come in the form of two grids: first, the colors grid (B/W), then the lengths (digits) grid.
	 * The grids should be separated by one or more blank lines.
	 * The parser does not currently support multi-digit lengths for pearls.
	 * @param renderOptions
	 * @returns
	 */
	public static fromText(text: string, renderOptions?: PearlRenderOptions) {
		const pearls: ConstructionPearl[] = [];
		const visitor: TextGridVisitor = ([char, lengthChar], coord) => {
			if (
				isEmptyGridCharacter(char) ||
				isEmptyGridCharacter(lengthChar)
			) {
				throw new Error(`Grids do not match at ${coord}`);
			}
			pearls.push({
				coord,
				color: parsePearlColor(char, coord),
				length: parseDigit(lengthChar, coord),
			});
		};
		const { width, height } = parseTextGrids(text, visitor, {
			gridCount: 2,
		});
		return new ShingokiPuzzle({ width, height, pearls, renderOptions });
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
			solver.add(
				...sightLineSumConstraints(
					context,
					pearl.vertex,
					pearl.length + 1,
					edgeVariables
				)
			);

			// const { coord } = pearl;
			// // Variables in each direction representing the number of straight-line steps taken from this pearl before turning.
			// const up = Int.const(`${coord}_up`);
			// const down = Int.const(`${coord}_down`);
			// const left = Int.const(`${coord}_left`);
			// const right = Int.const(`${coord}_right`);
			// const dirMap = {
			// 	up,
			// 	down,
			// 	left,
			// 	right,
			// };

			// for (const variable of [up, down, left, right]) {
			// 	// -1 here is correct because of closed loop constraint (if it took all the length,
			// 	// it would be a dead end)
			// 	solver.add(bound(variable, 0, pearl.length - 1));
			// }

			// solver.add(Sum(up, down, left, right).eq(pearl.length));

			// // Bind these variables to the indicator variables.
			// for (const direction of ['up', 'down', 'left', 'right'] as const) {
			// 	const lengthVariable = dirMap[direction];
			// 	for (
			// 		let stepsTaken = 0;
			// 		stepsTaken < pearl.length;
			// 		stepsTaken++
			// 	) {
			// 		const relevantIndicators = Array.from(
			// 			gridUtils.edges.directionalRun(
			// 				coord,
			// 				direction,
			// 				stepsTaken + 1
			// 			)
			// 		);
			// 		const [zeroEdge] = relevantIndicators.splice(-1);
			// 		const oneEdges = relevantIndicators;
			// 		solver.add(
			// 			Implies(
			// 				lengthVariable.eq(stepsTaken),
			// 				And(...oneEdges.map((e) => e.eq(1)), zeroEdge.eq(0))
			// 			)
			// 		);
			// 	}
			// }
		}

		for (const { color, vertex: coord } of this.#pearls) {
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
		const { vertex: coord } = this.#pearls[0];
		solver.add(
			...connectedLoopConstraints(
				edgeVariables,
				coord.incidentEdges(),
				context
			)
		);
		return edgeVariables;
	}

	protected override renderVertexData(t: 'black' | 'white'): string {
		return this.#renderChars[t];
	}
}

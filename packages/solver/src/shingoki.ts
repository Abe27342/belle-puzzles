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

		for (const pearl of this.#pearls) {
			solver.add(
				...sightLineSumConstraints(
					context,
					pearl.vertex,
					pearl.length + 1,
					edgeVariables
				)
			);
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

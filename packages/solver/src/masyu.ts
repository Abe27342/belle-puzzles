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
} from './constraint-utils.js';
import { mapIterable, oob } from './utils.js';
import { parseTextGrids } from './text-grid.js';
import type { TextGridVisitor } from './text-grid.js';

export interface MasyuPuzzleProps extends EdgeIndicatorPuzzleProps {
	pearls: ConstructionPearl[];
	renderOptions?: PearlRenderOptions;
}

interface Pearl {
	coord: GridVertex;
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

export class MasyuPuzzle extends EdgeIndicatorPuzzle<'black' | 'white', never> {
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
			if (!pearl.coord.isInBounds()) {
				throw new Error(`Pearl at ${pearl.coord} is out of bounds`);
			}
			this.vertexContents.set(pearl.coord.coord, pearl.color);
		}
	}

	public static fromText(text: string, renderOptions?: PearlRenderOptions) {
		const pearls: ConstructionPearl[] = [];
		const visitor: TextGridVisitor = ([char], coord) => {
			if (['B', 'b'].includes(char)) {
				pearls.push({ coord, color: 'black' });
			} else if (['W', 'w'].includes(char)) {
				pearls.push({ coord, color: 'white' });
			}
		};
		const { width, height } = parseTextGrids(text, visitor, {
			gridCount: 1,
		});
		return new MasyuPuzzle({ width, height, pearls, renderOptions });
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

		for (const { color, coord } of this.#pearls) {
			switch (color) {
				case 'black':
					solver.add(gridUtils.masyu.blackPearl(coord));
					break;
				case 'white':
					solver.add(gridUtils.masyu.whitePearl(coord));
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

	protected override renderVertexData(t: 'black' | 'white'): string {
		return this.#renderChars[t];
	}
}

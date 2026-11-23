import { CartesianCoord, GridEdge, GridFace } from './graph/index.js';
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
import { ensureNonEmpty } from './utils.js';
import { parseDigit, parseTextGrids } from './text-grid.js';
import type { TextGridVisitor } from './text-grid.js';

export interface CavePuzzleProps extends EdgeIndicatorPuzzleProps {
	givens: ConstructionGivens[];
	renderOptions?: EdgeIndicatorRenderOptions;
}

interface Given {
	face: GridFace;
	/**
	 * Number of faces that can be seen in all cardinal directions from this face
	 */
	count: number;
}

/**
 * @remarks
 * Used only prior to constructing a {@link CavePuzzle}.
 *
 * {@link Given} is more convenient to work with once the grid has been constructed.
 */
interface ConstructionGivens {
	coord: CartesianCoord;
	/**
	 * Number of faces that can be seen in all cardinal directions from this face
	 */
	count: number;
}

export class CavePuzzle extends EdgeIndicatorPuzzle<never, string> {
	#givens: Given[];

	constructor(props: CavePuzzleProps) {
		super(props);

		this.#givens = props.givens.map((p) => ({
			face: this.grid.getFace(p.coord),
			count: p.count,
		}));
		for (const given of this.#givens) {
			if (!given.face.isInBounds()) {
				throw new Error(`Given at ${given.face} is out of bounds`);
			}
			this.faceContents.set(given.face.coord, given.count.toString());
		}
	}

	public static fromText(
		text: string,
		renderOptions?: EdgeIndicatorRenderOptions
	) {
		const givens: ConstructionGivens[] = [];
		const visitor: TextGridVisitor = ([char], coord) => {
			givens.push({ coord, count: parseDigit(char, coord) });
		};
		const { width, height } = parseTextGrids(text, visitor, {
			gridCount: 1,
		});
		return new CavePuzzle({
			width: width + 1,
			height: height + 1,
			givens,
			renderOptions,
		});
	}

	public override addConstraints(
		context: Context<string>,
		solver: Solver<string>
	): Map<GridEdge, Arith<string>> {
		const edgeVariables = this.createEdgeIndicatorVariables(
			context,
			solver
		);

		for (const { count, face } of this.#givens) {
			solver.add(
				...sightLineSumConstraints(context, face, count, edgeVariables)
			);
		}

		// Givens with < 5 must have at least one adjacent edge.
		const given = this.#givens.find((g) => g.count < 5);
		solver.add(
			...connectedLoopConstraints(
				edgeVariables,
				given?.face.incidentEdges() ?? this.grid.edges(),
				context
			)
		);
		return edgeVariables;
	}
}

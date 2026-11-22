import { CartesianCoord, GridEdge, GridFace } from './graph/index.js';
import type { Arith, Context, Solver } from './z3.js';
import {
	EdgeIndicatorPuzzleProps,
	EdgeIndicatorPuzzle,
	EdgeIndicatorRenderOptions,
} from './edge-indicator-puzzle.js';
import { connectedLoopConstraints } from './constraint-utils.js';
import { ensureNonEmpty, oob } from './utils.js';
import { parseTextGrids } from './text-grid.js';
import type { TextGridVisitor } from './text-grid.js';

export interface SlitherlinkPuzzleProps extends EdgeIndicatorPuzzleProps {
	givens: ConstructionGivens[];
	renderOptions?: EdgeIndicatorRenderOptions;
}

interface Given {
	face: GridFace;
	/**
	 * Number of adjacent edges to this face
	 */
	count: number;
}

/**
 * @remarks
 * Used only prior to constructing a {@link SlitherlinkPuzzle}.
 *
 * {@link Given} is more convenient to work with once the grid has been constructed.
 */
interface ConstructionGivens {
	coord: CartesianCoord;
	/**
	 * Number of adjacent edges to this face
	 */
	count: number;
}

export class SlitherlinkPuzzle extends EdgeIndicatorPuzzle<never, string> {
	#givens: Given[];

	constructor(props: SlitherlinkPuzzleProps) {
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
			const digit = Number.parseInt(char);
			if (!Number.isNaN(digit) && 0 <= digit && digit <= 4) {
				givens.push({ coord, count: digit });
			}
		};
		const { width, height } = parseTextGrids(text, visitor, {
			gridCount: 1,
		});
		return new SlitherlinkPuzzle({
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

		const { Sum } = context;

		for (const { count, face } of this.#givens) {
			const adjacentFaceVariables = Array.from(
				face.incidentEdges(),
				(e) => edgeVariables.get(e) ?? oob(e)
			);
			solver.add(Sum(...ensureNonEmpty(adjacentFaceVariables)).eq(count));
		}

		// Pick an arbitrary nonzero constraint to use for the minimalEnabledVariables.
		const given = this.#givens.find((g) => g.count > 0);
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

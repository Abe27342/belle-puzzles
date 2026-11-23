import { CartesianCoord, GridFace } from './graph/index.js';
import type { Context, Solver } from './z3.js';
import {
	CartesianGridPuzzleProps,
	CartesianGridPuzzle,
	CartesianGridRenderOptions,
} from './cartesian-grid-puzzle.js';
import {
	createEdgeIndicatorModel,
	EdgeIndicatorModel,
	EdgeIndicatorSolution,
} from './edge-indicator-model.js';
import { constant } from './graph-output.js';
import { connectedLoopConstraints } from './constraint-utils.js';
import { ensureNonEmpty, oob } from './utils.js';
import { parseDigit, parseTextGrids } from './text-grid.js';
import type { TextGridVisitor } from './text-grid.js';

export interface SlitherlinkPuzzleProps extends CartesianGridPuzzleProps {
	givens: ConstructionGivens[];
	renderOptions?: CartesianGridRenderOptions;
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

export class SlitherlinkPuzzle extends CartesianGridPuzzle<EdgeIndicatorSolution> {
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
			this.output.faces.set(given.face, constant(given.count));
		}
	}

	public static fromText(
		text: string,
		renderOptions?: CartesianGridRenderOptions
	) {
		const givens: ConstructionGivens[] = [];
		const visitor: TextGridVisitor = ([char], coord) => {
			const digit = parseDigit(char, coord);
			if (digit > 4) {
				throw new Error(`Slitherlink clue at ${coord} must be 0-4`);
			}
			givens.push({ coord, count: digit });
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

	public override build(
		context: Context<string>,
		solver: Solver<string>
	): EdgeIndicatorModel {
		const model = createEdgeIndicatorModel(context, solver, this);
		const edgeVariables = model.variables;

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
		return model;
	}
}

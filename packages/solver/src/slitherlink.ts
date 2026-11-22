import { CartesianCoord, GridEdge, GridFace } from './graph/index.js';
import type { Arith, Context, Solver } from './z3.js';
import {
	EdgeIndicatorPuzzleProps,
	EdgeIndicatorPuzzle,
	EdgeIndicatorRenderOptions,
} from './edge-indicator-puzzle.js';
import { connectedLoopConstraints } from './constraint-utils.js';
import { ensureNonEmpty, oob } from './utils.js';

export interface SlitherlinkPuzzleProps extends EdgeIndicatorPuzzleProps {
	givens: ConstructionGivens[];
	renderOptions?: EdgeIndicatorRenderOptions;
}

interface Given {
	face: GridFace;
	/**
	 * Number of adjacent edges to this vertex
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
	 * Number of adjacent edges to this vertex
	 */
	count: number;
}

export class SlitherlinkPuzzle extends EdgeIndicatorPuzzle<never, string> {
	/**
	 * Note that the givens' coordinates are in terms of the face grid, not the vertex grid.
	 *
	 * Thus edges surrounding a given coordinate (v) are:
	 *
	 * [v, v.right]
	 * [v, v.down]
	 * [v.right, v.right.down]
	 * [v.down, v.down.right]
	 */
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

	public static fromTextGrid(
		text: string,
		renderOptions?: EdgeIndicatorRenderOptions
	) {
		const lines = text.trim().split('\n');
		const height = lines.length;
		const width = lines[0].length;
		const givens: ConstructionGivens[] = [];
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const char = lines[y][x];
				const digit = Number.parseInt(char);
				if (!Number.isNaN(digit) && 0 <= digit && digit <= 4) {
					givens.push({ coord: [x, y], count: digit });
				}
			}
		}
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

		// Pick an arbitrary pearl to use for the minimalEnabledVariables.
		const given = this.#givens.find((g) => g.count > 0);
		if (!given) {
			// ...one could write a slitherlink with only 0 clues, but it would be trivial to solve.
			// No use handling that robustly.
			throw new Error('No given with count > 0 found');
		}

		solver.add(
			...connectedLoopConstraints(
				edgeVariables,
				given.face.incidentEdges(),
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
}

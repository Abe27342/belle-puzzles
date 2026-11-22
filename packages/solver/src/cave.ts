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
} from './constraint-utils.js';
import { ensureNonEmpty } from './utils.js';

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

	// ... might be worth adding a csv parser (comma-separated cell values).
	// then we could also abstract out a generic text grid parser for similar puzzles.
	public static fromText(
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
				if (!Number.isNaN(digit)) {
					givens.push({ coord: [x, y], count: digit });
				}
			}
		}
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

		const { Sum, Int, Implies, And } = context;
		const { bound } = createConstraintExtensions(context);

		const gridUtils = createCartesianGridConstraintUtils(
			context,
			solver,
			this.grid,
			edgeVariables
		);

		const { getEdgeVar } = gridUtils.edges;

		for (const { count, face } of this.#givens) {
			const variables: Arith<string>[] = [];
			// Variables in each direction representing the number of straight-line faces visible from this face,
			// including the starting face.
			for (const edge of face.incidentEdges()) {
				const bearing = edge.bearingFrom(face);
				const variable = Int.const(`F${face}_B${bearing}`);
				solver.add(bound(variable, 1, count));
				variables.push(variable);

				// Bind straight-line visibility for this direction to the relevant edge indicator variables.
				const emptyEdges: GridEdge[] = [];
				let blockingEdge = edge;
				for (let stepsTaken = 0; stepsTaken < count; stepsTaken++) {
					solver.add(
						Implies(
							variable.eq(stepsTaken + 1),
							And(
								getEdgeVar(blockingEdge).eq(1),
								...emptyEdges.map((e) => getEdgeVar(e).eq(0))
							)
						)
					);

					emptyEdges.push(blockingEdge);
					blockingEdge = blockingEdge.translate(bearing);
				}
			}

			// We've counted the cell itself 4 times, but the actual count should include it only once.
			solver.add(Sum(...ensureNonEmpty(variables)).eq(count + 3));
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

	public override parseAssignment(assignment: string): 0 | 1 {
		const value = Number(assignment);
		if (value !== 0 && value !== 1) {
			throw new Error(`Invalid assignment value: ${value}`);
		}
		return value;
	}
}

import { registerPuzzle } from '../catalog.js';
import {
	CartesianGridPuzzle,
	constant,
	connectedLoopConstraints,
	createEdgeIndicatorModel,
	parseDigit,
	parseTextGrids,
	sightLineSumConstraints,
	type CartesianCoord,
	type CartesianGridPuzzleProps,
	type CartesianGridRenderOptions,
	type Context,
	type EdgeIndicatorModel,
	type EdgeIndicatorSolution,
	type GridFace,
	type Solver,
	type TextGridVisitor,
} from '../lib/index.js';

export interface CavePuzzleProps extends CartesianGridPuzzleProps {
	givens: ConstructionGivens[];
	renderOptions?: CartesianGridRenderOptions;
}

interface Given {
	face: GridFace;
	/**
	 * Number of visible faces in cardinal directions, including this face.
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
	 * Number of visible faces in cardinal directions, including this face.
	 */
	count: number;
}

declare module '../catalog.js' {
	interface PuzzleTypes {
		cave: typeof CavePuzzle;
	}
}

export class CavePuzzle extends CartesianGridPuzzle<EdgeIndicatorSolution> {
	static {
		registerPuzzle('cave', {
			name: 'Cave',
			instructions:
				'Enter a rectangular grid of single-digit cell clues (0-9). Multi-digit clues are not supported.',
			example: '1',
			parser: CavePuzzle,
		});
	}

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
			this.output.faces.set(given.face, constant(given.count));
		}
	}

	public static fromText(
		text: string,
		renderOptions?: CartesianGridRenderOptions
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

	public override build(
		context: Context<string>,
		solver: Solver<string>
	): EdgeIndicatorModel {
		const model = createEdgeIndicatorModel(context, solver, this);
		const edgeVariables = model.variables;

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
		return model;
	}
}

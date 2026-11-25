import { registerPuzzle } from '../catalog.js';
import {
	CartesianGridPuzzle,
	constant,
	connectedLoopConstraints,
	createEdgeIndicatorModel,
	ensureNonEmpty,
	oob,
	parseNumber,
	parseTextGrids,
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

export interface SlitherlinkPuzzleProps extends CartesianGridPuzzleProps {
	givens: ConstructionGivens[];
	renderOptions?: Partial<CartesianGridRenderOptions>;
}

interface Given {
	face: GridFace;
	/**
	 * Number of enabled edges bordering this face.
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
	 * Number of enabled edges bordering this face.
	 */
	count: number;
}

export class SlitherlinkPuzzle extends CartesianGridPuzzle<EdgeIndicatorSolution> {
	static {
		registerPuzzle('slitherlink', {
			name: 'Slitherlink',
			instructions:
				'Enter a rectangular grid of single-digit cell clues (0-4).',
			example: '....0.\n33..1.\n..12..\n..20..\n.1..11\n.2....',
			parser: SlitherlinkPuzzle,
		});
	}

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
		renderOptions?: Partial<CartesianGridRenderOptions>
	) {
		const givens: ConstructionGivens[] = [];
		const visitor: TextGridVisitor = ([char], coord) => {
			const digit = parseNumber(char, coord);
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
				context,
				this.grid,
				edgeVariables,
				given?.face.incidentEdges() ?? this.grid.edges()
			)
		);
		return model;
	}
}

import { registerPuzzle } from '../catalog.js';
import {
	CartesianGridPuzzle,
	constant,
	connectedLoopConstraints,
	createCartesianGridConstraintUtils,
	createEdgeIndicatorModel,
	parsePearlColor,
	parseTextGrids,
	type CartesianCoord,
	type CartesianGridPuzzleProps,
	type EdgeIndicatorModel,
	type EdgeIndicatorSolution,
	type GridVertex,
	type Solver,
	type TextGridVisitor,
	ContextExtended,
} from '../lib/index.js';

export interface MasyuPuzzleProps extends CartesianGridPuzzleProps {
	pearls: ConstructionPearl[];
}

interface Pearl {
	coord: GridVertex;
	color: 'black' | 'white';
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

export class MasyuPuzzle extends CartesianGridPuzzle<EdgeIndicatorSolution> {
	static {
		registerPuzzle({
			name: 'Masyu',
			instructions:
				'Enter B for black pearls and W for white pearls, one cell per grid vertex.',
			example: 'B.W...\n..W..W\n....B.\n.B....\n......\n....B.',
			parser: MasyuPuzzle,
		});
	}

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

	constructor(props: MasyuPuzzleProps) {
		super(props);

		this.#pearls = props.pearls.map((p) => ({
			coord: this.grid.getVertex(p.coord),
			color: p.color,
		}));
		for (const pearl of this.#pearls) {
			if (!pearl.coord.isInBounds()) {
				throw new Error(`Pearl at ${pearl.coord} is out of bounds`);
			}
			this.output.vertices.set(
				pearl.coord,
				constant(pearl.color, (color) =>
					color === 'black' ? 'B' : 'W'
				)
			);
		}
	}

	public static fromText(text: string) {
		const pearls: ConstructionPearl[] = [];
		const visitor: TextGridVisitor = ([char], coord) => {
			pearls.push({ coord, color: parsePearlColor(char, coord) });
		};
		const { width, height } = parseTextGrids(text, visitor, {
			gridCount: 1,
		});
		return new MasyuPuzzle({
			faceWidth: width - 1,
			faceHeight: height - 1,
			pearls,
		});
	}

	public override build(
		context: ContextExtended<string>,
		solver: Solver<string>
	): EdgeIndicatorModel {
		const model = createEdgeIndicatorModel(context, solver, this);
		const edgeVariables = model.variables;

		const gridUtils = createCartesianGridConstraintUtils(
			context,
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
				context,
				this.grid,
				edgeVariables,
				coord.incidentEdges() ?? this.grid.edges()
			)
		);
		return model;
	}
}

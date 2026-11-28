import { registerPuzzle } from '../catalog.js';
import {
	CartesianGridPuzzle,
	constant,
	connectedLoopConstraints,
	createCartesianGridConstraintUtils,
	createEdgeIndicatorModel,
	isEmptyGridCharacter,
	parseNumber,
	parsePearlColor,
	parseTextGrids,
	sightLineSumConstraints,
	type CartesianCoord,
	type VertexGridSizeProps,
	type EdgeIndicatorModel,
	type EdgeIndicatorSolution,
	type GridVertex,
	type Solver,
	type TextGridVisitor,
	DoubledGrid,
	ContextExtended,
} from '../lib/index.js';

export interface ShingokiPuzzleProps extends VertexGridSizeProps {
	pearls: ConstructionPearl[];
}

interface Pearl {
	vertex: GridVertex;
	color: 'black' | 'white';
	length: number;
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

export class ShingokiPuzzle extends CartesianGridPuzzle<EdgeIndicatorSolution> {
	static {
		registerPuzzle({
			name: 'Shingoki',
			instructions:
				'Enter two equally sized grids separated by a blank line: B/W pearl colors, then numeric lengths at the same positions.',
			example:
				'.W....\n..B...\n......\nB....W\nWB..B.\n......\n\n.3....\n..2...\n......\n6....5\n22..2.\n......',
			parser: ShingokiPuzzle,
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

	constructor(props: ShingokiPuzzleProps) {
		super(props);

		this.#pearls = props.pearls.map((p) => ({
			vertex: this.grid.getVertex(DoubledGrid.fromVertexIndices(p.coord)),
			color: p.color,
			length: p.length,
		}));
		for (const pearl of this.#pearls) {
			if (!pearl.vertex.isInBounds()) {
				throw new Error(`Pearl at ${pearl.vertex} is out of bounds`);
			}
			this.output.vertices.set(
				pearl.vertex,
				constant(pearl.color, (color) =>
					color === 'black' ? 'B' : 'W'
				)
			);
		}
	}

	/**
	 * @param text Text representation of the Shingoki puzzle grid.
	 * This should come in the form of two grids: first, the colors grid (B/W), then the lengths (digits) grid.
	 * The grids should be separated by one or more blank lines.
	 * Enclose multi-digit lengths in matching braces, brackets, or parentheses.
	 */
	public static fromText(text: string) {
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
				length: parseNumber(lengthChar, coord),
			});
		};
		const { width, height } = parseTextGrids(text, visitor, {
			gridCount: 2,
		});
		return new ShingokiPuzzle({
			vertexWidth: width,
			vertexHeight: height,
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
				context,
				this.grid,
				edgeVariables,
				coord.incidentEdges()
			)
		);
		return model;
	}
}

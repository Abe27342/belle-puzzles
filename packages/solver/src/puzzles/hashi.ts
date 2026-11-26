import { registerPuzzle } from '../catalog.js';
import {
	CartesianGridPuzzle,
	constant,
	connectedConstraints,
	createCartesianGridConstraintUtils,
	createEdgeValueModel,
	ensureNonEmpty,
	parseNumber,
	parseTextGrids,
	type CartesianCoord,
	type CartesianGridPuzzleProps,
	type Context,
	type EdgeValueModel,
	type EdgeValueSolution,
	type GridValueModelProps,
	type GridVertex,
	type Solver,
	type TextGridVisitor,
	ContextExtended,
} from '../lib/index.js';

export interface HashiPuzzleProps extends CartesianGridPuzzleProps {
	givens: ConstructionGiven[];
}

interface Given {
	vertex: GridVertex;
	/**
	 * Number of bridges that must exit this vertex.
	 */
	count: number;
}

/**
 * @remarks
 * Used only prior to constructing a {@link HashiPuzzle}.
 *
 * {@link Given} is more convenient to work with once the grid has been constructed.
 */
interface ConstructionGiven {
	coord: CartesianCoord;
	count: number;
}

type HashiEdgeModel = EdgeValueModel<0 | 1 | 2>;

type HashiSolution = EdgeValueSolution<0 | 1 | 2>;

export function createHashiEdgeModel(
	context: Context<string>,
	solver: Solver<string>,
	props: GridValueModelProps
): HashiEdgeModel {
	return createEdgeValueModel(context, solver, props, {
		values: [0, 1, 2] as const,
		glyphs: {
			horizontal: [' ', '-', '='],
			vertical: [' ', '|', '‖'],
		},
	});
}

export class HashiPuzzle extends CartesianGridPuzzle<HashiSolution> {
	static {
		registerPuzzle('hashi', {
			name: 'Hashi',
			instructions:
				'Enter a rectangular grid of islands, using digits 1-8 for their bridge counts.',
			example:
				'23.4.2.\n......2\n11..133\n2..8.52\n3.3...1\n..2..34\n3..31.2',
			parser: HashiPuzzle,
		});
	}

	#givens: Given[];

	constructor(props: HashiPuzzleProps) {
		super(props);

		this.#givens = props.givens.map((p) => ({
			vertex: this.grid.getVertex(p.coord),
			count: p.count,
		}));
		for (const given of this.#givens) {
			if (!given.vertex.isInBounds()) {
				throw new Error(`Island at ${given.vertex} is out of bounds`);
			}
			this.output.vertices.set(
				given.vertex,
				constant(given.count, String)
			);
		}
	}

	/**
	 * @param text Text representation of the Hashi puzzle grid.
	 */
	public static fromText(text: string) {
		const givens: ConstructionGiven[] = [];
		const visitor: TextGridVisitor = ([count], coord) => {
			givens.push({
				coord,
				count: parseNumber(count, coord),
			});
		};
		const { width, height } = parseTextGrids(text, visitor, {
			gridCount: 1,
		});
		return new HashiPuzzle({
			width,
			height,
			givens,
		});
	}

	public override build(
		context: ContextExtended<string>,
		solver: Solver<string>
	): HashiEdgeModel {
		const model = createHashiEdgeModel(context, solver, this);

		const edgeVariables = model.variables;

		const { And, Not } = context;

		const gridUtils = createCartesianGridConstraintUtils(
			context,
			this.grid,
			edgeVariables
		);
		const { degree } = context.graphConstraints(this.grid);

		const islandVertices = new Set<GridVertex>();
		const { getEdgeVar, goesHorizontallyThrough, goesVerticallyThrough } =
			gridUtils.edges;
		for (const { vertex, count } of this.#givens) {
			solver.add(degree(vertex, edgeVariables).eq(count));
			islandVertices.add(vertex);
		}

		for (const v of this.grid.vertices()) {
			if (!islandVertices.has(v)) {
				// Non-island vertices must have equal opposite edges and cannot have both horizontal and vertical edges.
				const [upEdge, downEdge, leftEdge, rightEdge] = [
					[v, v.up],
					[v, v.down],
					[v, v.left],
					[v, v.right],
				].map(([a, b]) => getEdgeVar(this.grid.getEdge(a, b)));
				solver.add(And(upEdge.eq(downEdge), leftEdge.eq(rightEdge)));
				solver.add(
					// (this doesn't in isolation prevent T junctions, but with the immediately prior constraint it is sufficient)
					Not(
						And(
							goesHorizontallyThrough(v),
							goesVerticallyThrough(v)
						)
					)
				);
			}
		}

		const selectedGiven = this.#givens.find((given) => given.count > 0);
		solver.add(
			...connectedConstraints(
				context,
				edgeVariables,
				selectedGiven?.vertex.incidentEdges() ?? this.grid.edges()
			)
		);

		return model;
	}
}

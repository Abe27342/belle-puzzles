import { CartesianCoord, GridVertex } from './graph/index.js';
import type { Context, Solver } from './z3.js';
import {
	CartesianGridPuzzleProps,
	CartesianGridPuzzle,
	CartesianGridRenderOptions,
	defaultCartesianGridRenderOptions,
} from './cartesian-grid-puzzle.js';
import { constant } from './graph-output.js';
import {
	createEdgeValueModel,
	EdgeValueModel,
	EdgeValueModelProps,
	EdgeValueSolution,
} from './edge-value-model.js';
import {
	connectedConstraints,
	createCartesianGridConstraintUtils,
} from './constraint-utils.js';
import { parseDigit, parseTextGrids } from './text-grid.js';
import type { TextGridVisitor } from './text-grid.js';
import { ensureNonEmpty } from './utils.js';

export interface HashiPuzzleProps extends CartesianGridPuzzleProps {
	givens: ConstructionGiven[];
	renderOptions?: HashiRenderOptions;
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

export interface HashiRenderOptions extends CartesianGridRenderOptions {
	doubleHorizontal: string;
	doubleVertical: string;
}

type HashiEdgeModel = EdgeValueModel<0 | 1 | 2>;

type HashiSolution = EdgeValueSolution<0 | 1 | 2>;

const defaultRenderOptions: HashiRenderOptions = {
	...defaultCartesianGridRenderOptions,
	doubleHorizontal: '=',
	doubleVertical: '‖',
};

export function createHashiEdgeModel(
	context: Context<string>,
	solver: Solver<string>,
	props: EdgeValueModelProps & {
		renderOptions?: Partial<HashiRenderOptions>;
	}
): HashiEdgeModel {
	const renderOptions = {
		...defaultRenderOptions,
		...props.renderOptions,
	};
	return createEdgeValueModel(context, solver, props, {
		values: [0, 1, 2] as const,
		glyphs: {
			horizontal: [
				' ',
				renderOptions.horizontal,
				renderOptions.doubleHorizontal,
			],
			vertical: [
				' ',
				renderOptions.vertical,
				renderOptions.doubleVertical,
			],
		},
	});
}

export class HashiPuzzle extends CartesianGridPuzzle<HashiSolution> {
	#givens: Given[];

	constructor(props: HashiPuzzleProps) {
		super(props);

		this.#givens = props.givens.map((p) => ({
			vertex: this.grid.getVertex(p.coord),
			count: p.count,
		}));
		for (const pearl of this.#givens) {
			if (!pearl.vertex.isInBounds()) {
				throw new Error(`Pearl at ${pearl.vertex} is out of bounds`);
			}
			this.output.vertices.set(
				pearl.vertex,
				constant(pearl.count, String)
			);
		}
	}

	/**
	 * @param text Text representation of the Hashi puzzle grid.
	 * @returns
	 */
	public static fromText(text: string, renderOptions?: HashiRenderOptions) {
		const givens: ConstructionGiven[] = [];
		const visitor: TextGridVisitor = ([count], coord) => {
			givens.push({
				coord,
				count: parseDigit(count, coord),
			});
		};
		const { width, height } = parseTextGrids(text, visitor, {
			gridCount: 1,
		});
		return new HashiPuzzle({
			width,
			height,
			givens,
			renderOptions,
		});
	}

	public override build(
		context: Context<string>,
		solver: Solver<string>
	): HashiEdgeModel {
		const model = createHashiEdgeModel(context, solver, this);

		const edgeVariables = model.variables;

		const { And, Sum, Not } = context;

		const gridUtils = createCartesianGridConstraintUtils(
			context,
			solver,
			this.grid,
			edgeVariables
		);

		const bridgeVertices = new Set<GridVertex>();
		const { getEdgeVar, goesHorizontallyThrough, goesVerticallyThrough } =
			gridUtils.edges;
		for (const { vertex, count } of this.#givens) {
			// Outgoing edge sums match the givens
			solver.add(
				Sum(
					...ensureNonEmpty(
						Array.from(vertex.incidentEdges(), getEdgeVar)
					)
				).eq(count)
			);
			bridgeVertices.add(vertex);
		}

		for (const v of this.grid.vertices()) {
			if (!bridgeVertices.has(v)) {
				// Non-bridge vertices must have equal opposite edges and cannot have both horizontal and vertical edges.
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
				edgeVariables,
				selectedGiven?.vertex.incidentEdges() ?? this.grid.edges(),
				context
			)
		);

		return model;
	}
}

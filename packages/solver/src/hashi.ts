import {
	CartesianCoord,
	CartesianGridGraph,
	GridEdge,
	GridVertex,
} from './graph/index.js';
import type { Arith, Context, Solver } from './z3.js';
import {
	CartesianGridPuzzleProps,
	CartesianGridPuzzle,
	CartesianGridRenderOptions,
	defaultCartesianGridRenderOptions,
} from './cartesian-grid-puzzle.js';
import {
	constant,
	createGraphOutput,
	GraphOutput,
	variable,
} from './graph-output.js';
import {
	connectedConstraints,
	createCartesianGridConstraintUtils,
} from './constraint-utils.js';
import { parseDigit, parseTextGrids } from './text-grid.js';
import type { TextGridVisitor } from './text-grid.js';
import { ensureNonEmpty } from './utils.js';
import { BuiltPuzzle } from './puzzle.js';

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

const defaultRenderOptions: HashiRenderOptions = {
	...defaultCartesianGridRenderOptions,
	doubleHorizontal: '=',
	doubleVertical: '‖',
};

interface HashiEdgeModel extends BuiltPuzzle<HashiSolution> {
	variables: Map<GridEdge, Arith<string>>;
}

type HashiSolution = Map<GridEdge, 0 | 1 | 2>;

export function createHashiEdgeModel(
	context: Context<string>,
	solver: Solver<string>,
	props: {
		grid: CartesianGridGraph;
		output?: GraphOutput;
		renderOptions?: Partial<HashiRenderOptions>;
	}
): HashiEdgeModel {
	const output = createGraphOutput(props.output);
	const renderOptions = {
		...defaultRenderOptions,
		...props.renderOptions,
	};
	const { Int } = context;
	const variables = new Map<GridEdge, Arith<string>>();

	const empty = ' ';
	const renderMap = {
		horizontal: [
			empty,
			renderOptions.horizontal,
			renderOptions.doubleHorizontal,
		],
		vertical: [empty, renderOptions.vertical, renderOptions.doubleVertical],
	};
	const valueToChar = (edge: GridEdge, value: number) => {
		const [start, end] = edge.vertices;
		const orientation = start.y === end.y ? 'horizontal' : 'vertical';
		return renderMap[orientation][value];
	};

	for (const edge of props.grid.edges()) {
		const bridgeVar = Int.const(edge.toString());
		solver.add(bridgeVar.ge(0).and(bridgeVar.le(2)));
		variables.set(edge, bridgeVar);
		output.edges.set(
			edge,
			variable(bridgeVar, decodeEdgeVariable, (value) =>
				valueToChar(edge, value)
			)
		);
	}
	return {
		variables,
		output,
		keyAssignments: [...variables.values()],
		decodeSolution(model) {
			return new Map(
				Array.from(variables, ([edge, expression]) => [
					edge,
					decodeEdgeVariable(model.eval(expression, true).toString()),
				])
			);
		},
	};
}

function decodeEdgeVariable(assignment: string): 0 | 1 | 2 {
	const value = Number(assignment);
	if (value !== 0 && value !== 1 && value !== 2) {
		throw new Error(`Invalid indicator assignment: ${assignment}`);
	}
	return value;
}

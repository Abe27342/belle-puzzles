import type { Arith, Context, Solver } from './z3.js';
import type { GridEdge, CartesianGridGraph } from './graph/index.js';
import type { BuiltPuzzle } from './puzzle.js';
import { createConstraintExtensions } from './constraint-utils.js';
import { createGraphOutput, GraphOutput, variable } from './graph-output.js';
import {
	CartesianGridRenderOptions,
	defaultCartesianGridRenderOptions,
} from './cartesian-grid-puzzle.js';

export type EdgeIndicatorSolution = Map<GridEdge, 0 | 1>;

export interface EdgeIndicatorModel extends BuiltPuzzle<EdgeIndicatorSolution> {
	/**
	 * Maps each {@link GridEdge} to an indicator variable.
	 */
	variables: Map<GridEdge, Arith<string>>;
}

export function decodeIndicator(assignment: string): 0 | 1 {
	const value = Number(assignment);
	if (value !== 0 && value !== 1) {
		throw new Error(`Invalid indicator assignment: ${assignment}`);
	}
	return value;
}

/**
 * Creates a model suitable for cartesian grid puzzles uniquely determined by the presence or absence of edges
 * in their grid.
 */
export function createEdgeIndicatorModel(
	context: Context<string>,
	solver: Solver<string>,
	props: {
		grid: CartesianGridGraph;
		output?: GraphOutput;
		renderOptions?: Partial<CartesianGridRenderOptions>;
	}
): EdgeIndicatorModel {
	const { createIndicator } = createConstraintExtensions(context);
	const output = createGraphOutput(props.output);
	const renderOptions = {
		...defaultCartesianGridRenderOptions,
		...props.renderOptions,
	};
	const variables = new Map<GridEdge, Arith<string>>();
	for (const edge of props.grid.edges()) {
		const indicator = createIndicator(solver, edge.toString());
		variables.set(edge, indicator);
		const [start, end] = edge.vertices;
		const enabledChar =
			start.y === end.y
				? renderOptions.horizontal
				: renderOptions.vertical;
		output.edges.set(
			edge,
			variable(indicator, decodeIndicator, (value) =>
				value === 1 ? enabledChar : ' '
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
					decodeIndicator(model.eval(expression, true).toString()),
				])
			);
		},
	};
}

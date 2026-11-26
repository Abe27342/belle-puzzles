import type { Context, Solver } from 'z3-solver';
import type { CartesianGraphTypes, GridEdge } from './graph/index.js';
import {
	createValueModel,
	GridValueModelProps,
	ValueModel,
} from './value-model.js';

export type EdgeValueSolution<T extends number> = Map<GridEdge, T>;

export type EdgeValueModel<T extends number> = ValueModel<
	GridEdge,
	T,
	CartesianGraphTypes
>;

export interface EdgeValueOptions<T extends number> {
	values: readonly T[];
	/** Omit to display decoded numeric values. */
	glyphs?: {
		horizontal: Record<T, string>;
		vertical: Record<T, string>;
	};
}

export type EdgeIndicatorSolution = EdgeValueSolution<0 | 1>;

export type EdgeIndicatorModel = EdgeValueModel<0 | 1>;

/** Preset for puzzles uniquely determined by the presence or absence of edges. */
export function createEdgeIndicatorModel(
	context: Context<string>,
	solver: Solver<string>,
	props: GridValueModelProps
): EdgeIndicatorModel {
	return createEdgeValueModel(context, solver, props, {
		values: [0, 1] as const,
		glyphs: {
			horizontal: [' ', '-'],
			vertical: [' ', '|'],
		},
	});
}

/**
 * Create a model uniquely determined by finite integer values on cartesian grid edges.
 *
 * When those integers are indicator variables, use {@link createEdgeIndicatorModel} instead for ergonomics.
 */
export function createEdgeValueModel<const T extends number>(
	context: Context<string>,
	solver: Solver<string>,
	props: GridValueModelProps,
	options: EdgeValueOptions<T>
): EdgeValueModel<T> {
	const glyphs = options.glyphs;
	return createValueModel(context, solver, {
		keys: props.grid.edges(),
		values: options.values,
		output: props.output,
		bind: (output, edge, binding) => output.edges.set(edge, binding),
		name: (edge) => edge.toString(),
		glyphs:
			glyphs === undefined
				? undefined
				: (edge) => {
						return edge.isHorizontal
							? glyphs.horizontal
							: glyphs.vertical;
				  },
	});
}

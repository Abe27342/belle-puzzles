import type { Context, Solver } from './z3.js';
import type { GridVertex } from './graph/index.js';
import {
	createValueModel,
	GridValueModelProps,
	ValueModel,
} from './value-model.js';

export type VertexValueSolution<T extends number> = Map<GridVertex, T>;

export type VertexValueModel<T extends number> = ValueModel<GridVertex, T>;

export interface VertexValueOptions<T extends number> {
	values: readonly T[];
	/** Omit to display decoded numeric values. */
	glyphs?: Record<T, string>;
}

/**
 * Create a model uniquely determined by finite integer values on grid vertices.
 */
export function createVertexValueModel<const T extends number>(
	context: Context<string>,
	solver: Solver<string>,
	props: GridValueModelProps,
	options: VertexValueOptions<T>
): VertexValueModel<T> {
	const glyphs = options.glyphs;
	return createValueModel(context, solver, {
		keys: props.grid.vertices(),
		values: options.values,
		output: props.output,
		bindings: (output) => output.vertices,
		name: (vertex) => `v_${vertex}`,
		glyphs: glyphs === undefined ? undefined : () => glyphs,
	});
}

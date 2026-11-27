import type { Context, Solver } from 'z3-solver';
import type { CartesianGraphTypes, GridFace } from './graph/index.js';
import {
	createValueModel,
	GridValueModelProps,
	ValueModel,
	ValueModelOptions,
} from './value-model.js';

export type FaceValueSolution<T extends number> = Map<GridFace, T>;

export type FaceValueModel<T extends number> = ValueModel<
	GridFace,
	T,
	CartesianGraphTypes
>;

export interface FaceValueOptions<T extends number> {
	values: readonly T[];
	/** Omit to display decoded numeric values. */
	glyphs?: Record<T, string>;
	bind?: ValueModelOptions<GridFace, T, CartesianGraphTypes>['bind'];
}

/**
 * Create a model uniquely determined by finite integer values on grid vertices.
 */
export function createFaceValueModel<const T extends number>(
	context: Context<string>,
	solver: Solver<string>,
	props: GridValueModelProps,
	options: FaceValueOptions<T>
): FaceValueModel<T> {
	const glyphs = options.glyphs;
	return createValueModel(context, solver, {
		keys: props.grid.faces(),
		values: options.values,
		output: props.output,
		bind:
			options.bind ??
			((output, face, binding) => output.faces.set(face, binding)),
		name: (face) => `f_${face}`,
		glyphs: glyphs === undefined ? undefined : () => glyphs,
	});
}

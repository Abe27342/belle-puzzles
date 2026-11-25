import type { Expr, Model } from 'z3-solver';
import type { GridEdge, GridFace, GridVertex } from './graph/index.js';

/**
 * Represents a binding that can be resolved to a string for some Z3 model at display time.
 *
 * @remarks
 * Use {@link constant} to create a binding with a fixed string value,
 * or {@link variable} to create a binding based on a Z3 expression.
 */
export interface RenderBinding {
	resolve(model: Model<string>): string;
}

/**
 * Maps each grid vertex/edge/face to a {@link RenderBinding} for display purposes.
 */
export interface GraphOutput {
	vertices: Map<GridVertex, RenderBinding>;
	edges: Map<GridEdge, RenderBinding>;
	faces: Map<GridFace, RenderBinding>;
}

/**
 * Maps each grid vertex/edge/face to a string for display purposes.
 * @remarks
 * Empty strings collapse otherwise empty columns. Multi-character strings are
 * padded to column widths, and horizontal edge glyphs repeat to fill their columns.
 */
export interface GraphDisplay {
	vertices: ReadonlyMap<GridVertex, string>;
	edges: ReadonlyMap<GridEdge, string>;
	faces: ReadonlyMap<GridFace, string>;
}

/** Each build gets its own maps, optionally seeded with constant bindings. */
export function createGraphOutput(source?: GraphOutput): GraphOutput {
	return {
		vertices: new Map(source?.vertices),
		edges: new Map(source?.edges),
		faces: new Map(source?.faces),
	};
}

export function constant<T>(
	value: T,
	format: (value: T) => string = String
): RenderBinding {
	return { resolve: () => format(value) };
}

export function variable(expression: Expr<string>): RenderBinding;
/** Decode the evaluated Z3 expression before applying the value formatter. */
export function variable<T>(
	expression: Expr<string>,
	decode: (assignment: Expr<string>) => T,
	format?: (value: T) => string
): RenderBinding;
export function variable<T>(
	expression: Expr<string>,
	decode?: (assignment: Expr<string>) => T,
	format: (value: T) => string = String
): RenderBinding {
	return {
		resolve(model) {
			const assignment = model.eval(expression, true);
			return decode === undefined
				? assignment.toString()
				: format(decode(assignment));
		},
	};
}

/**
 * Resolves a {@link GraphOutput} to a {@link GraphDisplay}.
 * @remarks
 * This happens eagerly so subsequent solves (which may use the same variables) cannot change an earlier display.
 */
export function resolveGraphOutput(
	output: GraphOutput,
	model: Model<string>
): GraphDisplay {
	const resolve = <T>(bindings: Map<T, RenderBinding>) =>
		new Map(
			Array.from(bindings, ([key, binding]) => [
				key,
				binding.resolve(model),
			])
		);
	return {
		vertices: resolve(output.vertices),
		edges: resolve(output.edges),
		faces: resolve(output.faces),
	};
}

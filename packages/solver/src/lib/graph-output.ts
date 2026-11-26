import type { Expr, Model } from 'z3-solver';
import type {
	ConcreteGraphTypes,
	GridEdge,
	GridFace,
	GridVertex,
	PlanarGraph,
} from './graph/index.js';

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
export interface GraphOutput<TConcrete extends ConcreteGraphTypes<TConcrete>> {
	vertices: Map<TConcrete['vertex'], RenderBinding>;
	edges: Map<TConcrete['edge'], RenderBinding>;
	faces: Map<TConcrete['face'], RenderBinding>;
}

/**
 * Maps each grid vertex/edge/face to a string for display purposes.
 * @remarks
 * Empty strings collapse otherwise empty columns. Multi-character strings are
 * padded to column widths, and horizontal edge glyphs repeat to fill their columns.
 */
export interface GraphDisplay<TConcrete extends ConcreteGraphTypes<TConcrete>> {
	vertices: ReadonlyMap<TConcrete['vertex'], string>;
	edges: ReadonlyMap<TConcrete['edge'], string>;
	faces: ReadonlyMap<TConcrete['face'], string>;
}

/** Each build gets its own maps, optionally seeded with constant bindings. */
export function createGraphOutput<
	TConcrete extends ConcreteGraphTypes<TConcrete>
>(source?: GraphOutput<TConcrete>): GraphOutput<TConcrete> {
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

export function constantGraphOutput<
	TConcrete extends ConcreteGraphTypes<TConcrete>
>(
	graph: PlanarGraph<TConcrete>,
	characters: { vertices: string; edges: string; faces: string }
): GraphOutput<TConcrete> {
	const output = createGraphOutput<TConcrete>();
	for (const vertex of graph.vertices()) {
		output.vertices.set(vertex, constant(characters.vertices));
	}
	for (const edge of graph.edges()) {
		output.edges.set(edge, constant(characters.edges));
	}
	for (const face of graph.faces()) {
		output.faces.set(face, constant(characters.faces));
	}
	return output;
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
export function resolveGraphOutput<
	TConcrete extends ConcreteGraphTypes<TConcrete>
>(
	output: GraphOutput<TConcrete>,
	model: Model<string>
): GraphDisplay<TConcrete> {
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

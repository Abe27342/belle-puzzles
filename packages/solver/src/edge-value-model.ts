import type { Arith, Context, Expr, Solver } from './z3.js';
import type { GridEdge, CartesianGridGraph } from './graph/index.js';
import type { BuiltPuzzle } from './puzzle.js';
import { createGraphOutput, GraphOutput, variable } from './graph-output.js';
import {
	CartesianGridRenderOptions,
	defaultCartesianGridRenderOptions,
} from './cartesian-grid-puzzle.js';

export type EdgeValueSolution<T extends number> = Map<GridEdge, T>;

export interface EdgeValueModel<T extends number>
	extends BuiltPuzzle<EdgeValueSolution<T>> {
	variables: Map<GridEdge, Arith<string>>;
}

export interface EdgeValueModelProps {
	grid: CartesianGridGraph;
	output?: GraphOutput;
}

export interface EdgeValueOptions<T extends number> {
	values: readonly T[];
	glyphs: {
		horizontal: Record<T, string>;
		vertical: Record<T, string>;
	};
}

/**
 * Decode evaluated integer numerals against a non-empty finite integer domain.
 */
export function createEdgeValueDecoder<T extends number>(
	values: readonly T[]
): (assignment: Expr<string>) => T {
	const domain = [...values];
	if (
		domain.length === 0 ||
		domain.some((value) => !Number.isSafeInteger(value))
	) {
		throw new Error(
			'Edge values must be a non-empty domain of safe integers'
		);
	}
	return (assignment) => {
		if (!assignment.ctx.isIntVal(assignment)) {
			throw new Error('Expected an integer edge assignment');
		}
		const integer = assignment.value();
		const decoded = domain.find(
			(value) => BigInt(value) === integer
		);
		if (decoded === undefined) {
			throw new Error(`Invalid edge assignment: ${integer}`);
		}
		return decoded;
	};
}

export type EdgeIndicatorSolution = EdgeValueSolution<0 | 1>;

export type EdgeIndicatorModel = EdgeValueModel<0 | 1>;

export const decodeIndicator = createEdgeValueDecoder([0, 1] as const);

/**
 * Create a model for cartesian grid puzzles uniquely determined by the presence or absence of edges.
 */
export function createEdgeIndicatorModel(
	context: Context<string>,
	solver: Solver<string>,
	props: EdgeValueModelProps & {
		renderOptions?: Partial<CartesianGridRenderOptions>;
	}
): EdgeIndicatorModel {
	const renderOptions = {
		...defaultCartesianGridRenderOptions,
		...props.renderOptions,
	};
	return createEdgeValueModel(context, solver, props, {
		values: [0, 1] as const,
		glyphs: {
			horizontal: [' ', renderOptions.horizontal],
			vertical: [' ', renderOptions.vertical],
		},
	});
}

/**
 * Create a model for cartesian grid puzzles uniquely determined by assigning integer values to edges.
 *
 * When those integers are indicator variables, use {@link createEdgeIndicatorModel} instead for ergonomics.
 */
export function createEdgeValueModel<const T extends number>(
	context: Context<string>,
	solver: Solver<string>,
	props: EdgeValueModelProps,
	options: EdgeValueOptions<T>
): EdgeValueModel<T> {
	const values = [...options.values];
	const decode = createEdgeValueDecoder(values);
	const domain = [...new Set(values)].sort((a, b) => a - b);
	const minimum = domain[0];
	const maximum = domain[domain.length - 1];
	const contiguous = domain.every(
		(value, index) => value === minimum + index
	);
	for (const value of values) {
		if (
			typeof options.glyphs.horizontal[value] !== 'string' ||
			typeof options.glyphs.vertical[value] !== 'string'
		) {
			throw new Error(`Missing edge glyph for value ${value}`);
		}
	}
	const output = createGraphOutput(props.output);
	const variables = new Map<GridEdge, Arith<string>>();
	for (const edge of props.grid.edges()) {
		const expression = context.Int.const(edge.toString());
		solver.add(
			contiguous
				? expression.ge(minimum).and(expression.le(maximum))
				: context.Or(...domain.map((value) => expression.eq(value)))
		);
		variables.set(edge, expression);
		const [start, end] = edge.vertices;
		const glyphs =
			start.y === end.y
				? options.glyphs.horizontal
				: options.glyphs.vertical;
		output.edges.set(
			edge,
			variable(expression, decode, (value) => glyphs[value])
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
					decode(model.eval(expression, true)),
				])
			);
		},
	};
}

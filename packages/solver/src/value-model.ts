import type { Arith, Context, Expr, Solver } from './z3.js';
import type { CartesianGridGraph } from './graph/index.js';
import type { BuiltPuzzle } from './puzzle.js';
import {
	createGraphOutput,
	GraphOutput,
	RenderBinding,
	variable,
} from './graph-output.js';

/**
 * A {@link BuiltPuzzle} model represented by finite integer values assigned to keys of type `TKey`.
 *
 * @remarks
 * Several helper functions provide convenient ways to create and manipulate value models for grid-based puzzles.
 *
 * Common variants include creating indicator variables for each edge or vertex.
 */
export interface ValueModel<TKey, TValue extends number>
	extends BuiltPuzzle<Map<TKey, TValue>> {
	variables: Map<TKey, Arith<string>>;
}

export interface GridValueModelProps {
	grid: CartesianGridGraph;
	output?: GraphOutput;
}

export interface ValueModelOptions<TKey, TValue extends number> {
	/** All keys for which values will be assigned. */
	keys: Iterable<TKey>;
	/** Domain of possible values to assign. */
	values: readonly TValue[];
	output?: GraphOutput;
	bindings(output: GraphOutput): Map<TKey, RenderBinding>;
	/** Name of the variable corresponding to the given key. */
	name(key: TKey): string;
	/** Omit to format decoded values with String instead of a glyph table. */
	glyphs?(key: TKey): Record<TValue, string>;
}

/** Decode evaluated integer numerals against a non-empty finite integer domain. */
export function createValueDecoder<T extends number>(
	values: readonly T[]
): (assignment: Expr<string>) => T {
	const domain = new Set(values);
	if (
		domain.size === 0 ||
		[...domain].some((value) => !Number.isSafeInteger(value))
	) {
		throw new Error('Values must be a non-empty domain of safe integers');
	}
	return (assignment) => {
		if (!assignment.ctx.isIntVal(assignment)) {
			throw new Error('Expected an integer value assignment');
		}
		const decoded = toSafeNumber(assignment.value()) as T;
		if (!domain.has(decoded)) {
			throw new Error(`Invalid value assignment: ${decoded}`);
		}
		return decoded;
	};
}

function toSafeNumber(bigIntVal: bigint) {
	if (
		bigIntVal > BigInt(Number.MAX_SAFE_INTEGER) ||
		bigIntVal < BigInt(Number.MIN_SAFE_INTEGER)
	) {
		throw new RangeError('BigInt exceeds safe Number range');
	}
	return Number(bigIntVal);
}

export function createValueModel<TKey, const TValue extends number>(
	context: Context<string>,
	solver: Solver<string>,
	options: ValueModelOptions<TKey, TValue>
): ValueModel<TKey, TValue> {
	const values = [...options.values];
	const decode = createValueDecoder(values);
	const domain = [...new Set(values)].sort((a, b) => a - b);
	const minimum = domain[0];
	const maximum = domain[domain.length - 1];
	const contiguous = domain.every(
		(value, index) => value === minimum + index
	);
	const entries = Array.from(options.keys, (key) => ({
		key,
		name: options.name(key),
		glyphs: options.glyphs?.(key),
	}));
	for (const { glyphs } of entries) {
		if (options.glyphs !== undefined) {
			for (const value of domain) {
				if (typeof glyphs?.[value] !== 'string') {
					throw new Error(`Missing value glyph for value ${value}`);
				}
			}
		}
	}

	const output = createGraphOutput(options.output);
	const bindings = options.bindings(output);
	const variables = new Map<TKey, Arith<string>>();
	for (const { key, name, glyphs } of entries) {
		const expression = context.Int.const(name);
		solver.add(
			contiguous
				? expression.ge(minimum).and(expression.le(maximum))
				: context.Or(...domain.map((value) => expression.eq(value)))
		);
		variables.set(key, expression);
		bindings.set(
			key,
			variable(
				expression,
				decode,
				glyphs === undefined ? undefined : (value) => glyphs[value]
			)
		);
	}
	return {
		variables,
		output,
		keyAssignments: [...variables.values()],
		decodeSolution(model) {
			return new Map(
				Array.from(variables, ([key, expression]) => [
					key,
					decode(model.eval(expression, true)),
				])
			);
		},
	};
}

import type { Context, Solver } from 'z3-solver';
import { CartesianGraphTypes, CartesianGridGraph } from './graph/index.js';
import {
	constantGraphOutput,
	constant,
	GraphDisplay,
	GraphOutput,
} from './graph-output.js';
import type { BuiltPuzzle, PuzzleDefinition } from './puzzle.js';

export interface CartesianGridPuzzleProps {
	faceWidth: number;
	faceHeight: number;
}

export type CreateOutput = (
	grid: CartesianGridGraph
) => GraphOutput<CartesianGraphTypes>;

export const cdot = '·';

const linedGrid: CreateOutput = (grid) => {
	const output = constantGraphOutput<CartesianGraphTypes>(grid, {
		vertices: cdot,
		edges: '',
		faces: ' ',
	});

	for (const edge of grid.edges()) {
		output.edges.set(edge, constant(edge.isHorizontal ? '-' : '|'));
	}

	return output;
};

const vertexOnlyGrid: CreateOutput = (grid) =>
	constantGraphOutput<CartesianGraphTypes>(grid, {
		vertices: cdot,
		edges: '',
		faces: '',
	});
export const outputFactories = {
	/**
	 * @returns A factory for rendering vertices, edges, and faces.
	 */
	linedGrid,
	/**
	 * @returns A factory for rendering output only for vertices.
	 */
	vertexOnlyGrid,
} as const;

/**
 * Convenience class for Cartesian grid puzzles.
 */
export abstract class CartesianGridPuzzle<
	TSolution = GraphDisplay<CartesianGraphTypes>
> implements PuzzleDefinition<CartesianGraphTypes, TSolution>
{
	public readonly grid: CartesianGridGraph;
	public readonly output: GraphOutput<CartesianGraphTypes>;

	constructor(
		props: CartesianGridPuzzleProps,
		createOutput: CreateOutput = linedGrid
	) {
		this.grid = new CartesianGridGraph(props);
		this.output = createOutput(this.grid);
	}

	public abstract build(
		context: Context<string>,
		solver: Solver<string>
	): BuiltPuzzle<CartesianGraphTypes, TSolution>;
}

/**
 * Lay out resolved bindings without interpreting their values or Z3 sorts.
 * Explicitly empty interstitial rows are omitted. This allows compact rendering when edges aren't important.
 */
export function renderCartesianGrid(
	grid: CartesianGridGraph,
	display: GraphDisplay<CartesianGraphTypes>
): string {
	const rows: { values: string[]; horizontalEdges: boolean }[] = [];
	for (let y = 0; y < grid.vertexHeight; y++) {
		const contentLine: string[] = [];
		const verticalEdgeLine: string[] = [];
		for (let x = 0; x < grid.vertexWidth; x++) {
			const current = grid.getVertex([x, y]);
			contentLine.push(display.vertices.get(current) ?? cdot);
			if (x < grid.vertexWidth - 1) {
				const edge = grid.getEdge(current, current.right);
				contentLine.push(display.edges.get(edge) ?? ' ');
			}
			if (y < grid.vertexHeight - 1) {
				const edge = grid.getEdge(current, current.down);
				verticalEdgeLine.push(display.edges.get(edge) ?? ' ');
				if (x < grid.vertexWidth - 1) {
					verticalEdgeLine.push(
						display.faces.get(grid.getFace([x, y])) ?? ' '
					);
				}
			}
		}
		rows.push({ values: contentLine, horizontalEdges: true });
		if (verticalEdgeLine.some((value) => value.length > 0)) {
			rows.push({ values: verticalEdgeLine, horizontalEdges: false });
		}
	}
	const widths: number[] = [];
	for (const { values } of rows) {
		values.forEach((value, column) => {
			widths[column] = Math.max(widths[column] ?? 0, value.length);
		});
	}
	return rows
		.map(
			({ values, horizontalEdges }) =>
				values
					.map((value, column) =>
						horizontalEdges &&
						column % 2 === 1 &&
						value.length === 1
							? value.repeat(widths[column])
							: value.padEnd(widths[column])
					)
					.join('') + '\n'
		)
		.join('');
}

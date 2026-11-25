import type { Context, Solver } from 'z3-solver';
import { CartesianGridGraph } from './graph/index.js';
import { createGraphOutput, GraphDisplay } from './graph-output.js';
import type { BuiltPuzzle, PuzzleDefinition } from './puzzle.js';

export interface CartesianGridRenderOptions {
	vertex: string;
	horizontal: string;
	vertical: string;
}

export const defaultCartesianGridRenderOptions: CartesianGridRenderOptions = {
	vertex: '·',
	horizontal: '━',
	vertical: '┃',
};

export interface CartesianGridPuzzleProps {
	width: number;
	height: number;
	renderOptions?: Partial<CartesianGridRenderOptions>;
}

/**
 * Convenience class for Cartesian grid puzzles.
 */
export abstract class CartesianGridPuzzle<TSolution = GraphDisplay>
	implements PuzzleDefinition<TSolution>
{
	public readonly grid: CartesianGridGraph;
	public readonly output = createGraphOutput();
	public readonly renderOptions: CartesianGridRenderOptions;

	constructor(props: CartesianGridPuzzleProps) {
		this.grid = new CartesianGridGraph(props);
		this.renderOptions = {
			...defaultCartesianGridRenderOptions,
			...props.renderOptions,
		};
	}

	public get width() {
		return this.grid.width;
	}

	public get height() {
		return this.grid.height;
	}

	public abstract build(
		context: Context<string>,
		solver: Solver<string>
	): BuiltPuzzle<TSolution>;
}

/**
 * Lay out resolved bindings without interpreting their values or Z3 sorts.
 * Explicitly empty interstitial rows are omitted. This allows compact rendering when edges aren't important.
 */
export function renderCartesianGrid(
	grid: CartesianGridGraph,
	display: GraphDisplay,
	options: Partial<CartesianGridRenderOptions> = {}
): string {
	const vertexChar =
		options.vertex ?? defaultCartesianGridRenderOptions.vertex;
	const rows: { values: string[]; horizontalEdges: boolean }[] = [];
	for (let y = 0; y < grid.height; y++) {
		const contentLine: string[] = [];
		const verticalEdgeLine: string[] = [];
		for (let x = 0; x < grid.width; x++) {
			const current = grid.getVertex([x, y]);
			contentLine.push(display.vertices.get(current) ?? vertexChar);
			if (x < grid.width - 1) {
				const edge = grid.getEdge(current, current.right);
				contentLine.push(display.edges.get(edge) ?? ' ');
			}
			if (y < grid.height - 1) {
				const edge = grid.getEdge(current, current.down);
				verticalEdgeLine.push(display.edges.get(edge) ?? ' ');
				if (x < grid.width - 1) {
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

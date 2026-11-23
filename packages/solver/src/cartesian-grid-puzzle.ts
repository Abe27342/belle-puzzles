import type { Context, Solver } from './z3.js';
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

/** Optional convenience class; solving and rendering do not depend on it. */
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

/** Lay out resolved bindings without interpreting their values or Z3 sorts. */
export function renderCartesianGrid(
	grid: CartesianGridGraph,
	display: GraphDisplay,
	options: Partial<CartesianGridRenderOptions> = {}
): string {
	const vertexChar =
		options.vertex ?? defaultCartesianGridRenderOptions.vertex;
	let result = '';
	for (let y = 0; y < grid.height; y++) {
		let contentLine = '';
		let verticalEdgeLine = '';
		for (let x = 0; x < grid.width; x++) {
			const current = grid.getVertex([x, y]);
			contentLine += display.vertices.get(current) ?? vertexChar;
			if (x < grid.width - 1) {
				const edge = grid.getEdge(current, current.right);
				contentLine += display.edges.get(edge) ?? ' ';
			}
			if (y < grid.height - 1) {
				const edge = grid.getEdge(current, current.down);
				verticalEdgeLine += display.edges.get(edge) ?? ' ';
				if (x < grid.width - 1) {
					verticalEdgeLine +=
						display.faces.get(grid.getFace([x, y])) ?? ' ';
				}
			}
		}
		result += contentLine + '\n';
		if (y < grid.height - 1) {
			result += verticalEdgeLine + '\n';
		}
	}
	return result;
}

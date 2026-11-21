import { Context, Arith } from 'z3-solver';
import { Edge, CartesianGrid, CartesianCoord, Vertex } from './grid';
import { Puzzle } from './puzzle';

export interface EdgeIndicatorPuzzleProps {
	width: number;
	height: number;
	renderOptions?: EdgeIndicatorRenderOptions;
}

export type EdgeIndicatorRenderOptions = Record<
	'vertex' | 'horizontal' | 'vertical',
	string
>;

/**
 * Base class for puzzles whose solution is represented by indicator functions on the edges of a grid.
 *
 * Ex: slitherlink, masyu
 */
export abstract class EdgeIndicatorPuzzle<TCell> extends Puzzle<Edge, 0 | 1> {
	#width: number;
	#height: number;

	protected grid: CartesianGrid<TCell | 'empty'>;

	#renderOptions: EdgeIndicatorRenderOptions;

	public get width() {
		return this.#width;
	}

	public get height() {
		return this.#height;
	}

	constructor(props: EdgeIndicatorPuzzleProps) {
		super();
		this.#width = props.width;
		this.#height = props.height;
		this.grid = CartesianGrid.fromDimensions(
			this.#width,
			this.#height,
			() => 'empty'
		);
		this.#renderOptions = props.renderOptions ?? {
			vertex: '·',
			horizontal: '━',
			vertical: '┃',
		};
	}

	public getCell(coord: CartesianCoord | Vertex): TCell | 'empty' {
		return this.grid.get(coord);
	}

	protected createEdgeVariables(
		context: Context<string>,
		prefix = ''
	): Map<Edge, Arith<string>> {
		const edgeVariables = new Map<Edge, Arith<string>>();
		for (const edge of this.grid.edges()) {
			edgeVariables.set(
				edge,
				context.Int.const(prefix + edge.toString())
			);
		}
		return edgeVariables;
	}

	public override parseAssignment(assignment: string): 0 | 1 {
		const value = Number(assignment);
		if (value !== 0 && value !== 1) {
			throw new Error(`Invalid assignment value: ${value}`);
		}
		return value;
	}

	public abstract renderT(t: TCell): string;

	public renderSolution(
		assignment: 'unsat' | 'unknown' | Map<Edge, 0 | 1>
	): string {
		if (typeof assignment === 'string') {
			return assignment;
		}

		const renderChar = (t: TCell | 'empty') =>
			t === 'empty' ? this.#renderOptions.vertex : this.renderT(t);

		let result = '';
		for (let y = 0; y < this.height; y++) {
			let contentLine = '';
			let verticalEdgeLine = '';
			for (let x = 0; x < this.width; x++) {
				const current = this.grid.getVertex([x, y]);
				contentLine += renderChar(this.getCell(current));

				const rightEdge = this.grid.getEdge(current, current.right);
				const rightEdgeAssignment = assignment.get(rightEdge);
				if (rightEdgeAssignment !== undefined) {
					contentLine +=
						rightEdgeAssignment === 1
							? this.#renderOptions.horizontal
							: ' ';
				}

				const downEdge = this.grid.getEdge(current, current.down);
				const downEdgeAssignment = assignment.get(downEdge);
				verticalEdgeLine +=
					downEdgeAssignment === 1
						? this.#renderOptions.vertical + ' '
						: '  ';
			}

			result += contentLine + '\n';

			if (y < this.height - 1) {
				result += verticalEdgeLine + '\n';
			}
		}

		return result;
	}
}

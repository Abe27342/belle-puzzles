import { Context, Arith, Solver } from 'z3-solver';
import {
	GridEdge,
	CartesianGrid,
	CartesianCoord,
	GridVertex,
} from './grid/index.js';
import { Puzzle } from './puzzle.js';
import { createConstraintExtensions } from './constraint-utils.js';

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
export abstract class EdgeIndicatorPuzzle<TCell> extends Puzzle<
	GridEdge,
	0 | 1
> {
	#width: number;
	#height: number;

	protected grid: CartesianGrid<TCell | 'empty'>;

	/**
	 * Grid representing the face contents of the puzzle.
	 *
	 * This grid has dimensions (width - 1) x (height - 1).
	 *
	 * This grid is used when rendering the puzzle with {@link renderSolution}.
	 * Classes extending {@link EdgeIndicatorPuzzle} can place length-1 content in cells of the grid
	 * to improve that rendering.
	 *
	 * This is useful for puzzles which indicate clues in cells, e.g. slitherlink.
	 */
	protected faceGrid: CartesianGrid<string>;

	/**
	 * Given a face coordinate, returns all edge variables that border this face.
	 *
	 * This is the kind of thing you want to use for grid puzzles that express constraints "inside the boxes" which affect the surrounding edges
	 * (e.g. slitherlink).
	 * @param v The vertex corresponding to the face coordinate.
	 * @returns An object containing the edge indicator variables for the edges adjacent to the face coordinate.
	 */
	public edgesAdjacentToFace(v: GridVertex): {
		top: GridEdge;
		left: GridEdge;
		bottom: GridEdge;
		right: GridEdge;
	} {
		const top = this.grid.getEdge(v, v.right);
		const left = this.grid.getEdge(v, v.down);
		const bottom = this.grid.getEdge(v.down, v.down.right);
		const right = this.grid.getEdge(v.right, v.right.down);
		return { top, left, bottom, right };
	}

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

		this.faceGrid = CartesianGrid.fromDimensions(
			this.#width - 1,
			this.#height - 1,
			() => ' '
		);
		this.#renderOptions = props.renderOptions ?? {
			vertex: '·',
			horizontal: '━',
			vertical: '┃',
		};
	}

	public getCell(coord: CartesianCoord | GridVertex): TCell | 'empty' {
		return this.grid.get(coord);
	}

	protected createEdgeIndicatorVariables(
		context: Context<string>,
		solver: Solver<string>,
		prefix = ''
	): Map<GridEdge, Arith<string>> {
		const edgeVariables = new Map<GridEdge, Arith<string>>();
		const { createIndicator } = createConstraintExtensions(context);
		for (const edge of this.grid.edges()) {
			edgeVariables.set(
				edge,
				createIndicator(solver, prefix + edge.toString())
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
		assignment: 'unsat' | 'unknown' | Map<GridEdge, 0 | 1>
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
						? this.#renderOptions.vertical
						: ' ';

				if (x < this.width - 1 && y < this.height - 1) {
					verticalEdgeLine += this.faceGrid.get([x, y]);
				}
			}

			result += contentLine + '\n';

			if (y < this.height - 1) {
				result += verticalEdgeLine + '\n';
			}
		}

		return result;
	}
}

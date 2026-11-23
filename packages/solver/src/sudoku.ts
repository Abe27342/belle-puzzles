import { CartesianCoord, GridVertex } from './graph/index.js';
import type { Context, Solver } from './z3.js';
import {
	CartesianGridPuzzleProps,
	CartesianGridPuzzle,
	CartesianGridRenderOptions,
	defaultCartesianGridRenderOptions,
} from './cartesian-grid-puzzle.js';
import { parseDigit, parseTextGrids } from './text-grid.js';
import type { TextGridVisitor } from './text-grid.js';
import { ensureNonEmpty, oob } from './utils.js';
import {
	createVertexValueModel,
	VertexValueModel,
	VertexValueSolution,
} from './vertex-value-model.js';

export interface SudokuPuzzleProps extends CartesianGridPuzzleProps {
	givens: ConstructionGiven[];
}

interface Given {
	vertex: GridVertex;
	/**
	 * Value of the Sudoku cell at this vertex.
	 */
	value: number;
}

/**
 * @remarks
 * Used only prior to constructing a {@link SudokuPuzzle}.
 *
 * {@link Given} is more convenient to work with once the grid has been constructed.
 */
interface ConstructionGiven {
	coord: CartesianCoord;
	value: number;
}

type SudokuDigit = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

type SudokuEdgeModel = VertexValueModel<SudokuDigit>;

type SudokuSolution = VertexValueSolution<SudokuDigit>;

export class SudokuPuzzle extends CartesianGridPuzzle<SudokuSolution> {
	#givens: Given[];

	constructor(props: SudokuPuzzleProps) {
		super(props);

		this.#givens = props.givens.map((p) => ({
			vertex: this.grid.getVertex(p.coord),
			value: p.value,
		}));
		for (const given of this.#givens) {
			if (!given.vertex.isInBounds()) {
				throw new Error(`Pearl at ${given.vertex} is out of bounds`);
			}
		}
	}

	/**
	 * @param text Text representation of the Sudoku puzzle grid.
	 * @returns
	 */
	public static fromText(
		text: string,
		renderOptions: CartesianGridRenderOptions = defaultCartesianGridRenderOptions
	) {
		const givens: ConstructionGiven[] = [];
		const visitor: TextGridVisitor = ([count], coord) => {
			givens.push({
				coord,
				value: parseDigit(count, coord),
			});
		};
		const { width, height } = parseTextGrids(text, visitor, {
			gridCount: 1,
		});

		if (width !== 9 || height !== 9) {
			throw new Error(`Invalid Sudoku grid size: ${width}x${height}`);
		}

		return new SudokuPuzzle({
			width,
			height,
			givens,
			renderOptions,
		});
	}

	public override build(
		context: Context<string>,
		solver: Solver<string>
	): SudokuEdgeModel {
		const model = createVertexValueModel(context, solver, this, {
			values: [1, 2, 3, 4, 5, 6, 7, 8, 9] as const,
		});

		const variables = model.variables;
		const varAt = (coord: CartesianCoord) =>
			variables.get(this.grid.getVertex(coord)) ?? oob(coord);

		const { Distinct } = context;
		for (const given of this.#givens) {
			solver.add(varAt(given.vertex.coord).eq(given.value));
		}

		for (let i = 0; i < 9; i++) {
			// Distinct columns
			solver.add(
				Distinct(
					...ensureNonEmpty(
						Array.from({ length: 9 }, (_, j) => varAt([i, j]))
					)
				)
			);
			// Distinct rows
			solver.add(
				Distinct(
					...ensureNonEmpty(
						Array.from({ length: 9 }, (_, j) => varAt([j, i]))
					)
				)
			);
		}

		for (let topIndex = 0; topIndex < 9; topIndex += 3) {
			for (let leftIndex = 0; leftIndex < 9; leftIndex += 3) {
				const blockVars = [];
				for (let i = 0; i < 3; i++) {
					for (let j = 0; j < 3; j++) {
						blockVars.push(varAt([topIndex + i, leftIndex + j]));
					}
				}
				// Distinct blocks
				solver.add(Distinct(...ensureNonEmpty(blockVars)));
			}
		}

		return model;
	}
}

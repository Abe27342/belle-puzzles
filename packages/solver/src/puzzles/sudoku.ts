import { registerPuzzle } from '../catalog.js';
import {
	CartesianGridPuzzle,
	constant,
	createVertexValueModel,
	ensureNonEmpty,
	oob,
	outputFactories,
	parseNumber,
	parseTextGrids,
	Point,
	type VertexGridSizeProps,
	type Context,
	type CreateOutput,
	type GridVertex,
	type Solver,
	type TextGridVisitor,
	DoubledGrid,
	type VertexValueModel,
	type VertexValueSolution,
} from '../lib/index.js';

export interface SudokuPuzzleProps extends VertexGridSizeProps {
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
	coord: Point;
	value: number;
}

type SudokuDigit = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

type SudokuModel = VertexValueModel<SudokuDigit>;

type SudokuSolution = VertexValueSolution<SudokuDigit>;

const sudokuOutput: CreateOutput = (grid) => {
	const output = outputFactories.vertexOnlyGrid(grid);
	const needsSeparator = (position: number) => (position + 1) % 3 === 0;
	for (const edge of grid.edges()) {
		const [start, end] = edge.vertices;
		const horizontal = start.y === end.y;
		const position = horizontal ? start.x : start.y;
		const separator = horizontal ? '|' : '-';
		output.edges.set(
			edge,
			constant(needsSeparator(position) ? separator : '')
		);
	}
	for (const face of grid.faces()) {
		const x = face.x;
		const y = face.y;
		const intersection = needsSeparator(x) && needsSeparator(y);
		output.faces.set(face, constant(intersection ? '+' : ''));
	}
	return output;
};

export class SudokuPuzzle extends CartesianGridPuzzle<SudokuSolution> {
	static {
		registerPuzzle({
			name: 'Sudoku',
			instructions:
				'Enter nine rows of nine cells. Use digits 1-9 for givens.',
			example:
				'53..7....\n6..195...\n.98....6.\n8...6...3\n4..8.3..1\n7...2...6\n.6....28.\n...419..5\n....8..79',
			parser: SudokuPuzzle,
		});
	}

	#givens: Given[];

	constructor(props: SudokuPuzzleProps) {
		super(props, sudokuOutput);

		this.#givens = props.givens.map((p) => ({
			vertex: this.grid.getVertex(DoubledGrid.fromVertexIndices(p.coord)),
			value: p.value,
		}));
		for (const given of this.#givens) {
			if (!given.vertex.isInBounds()) {
				throw new Error(`Given at ${given.vertex} is out of bounds`);
			}
		}
	}

	/**
	 * @param text Text representation of the Sudoku puzzle grid.
	 */
	public static fromText(text: string) {
		const givens: ConstructionGiven[] = [];
		const visitor: TextGridVisitor = ([value], coord) => {
			givens.push({
				coord,
				value: parseNumber(value, coord),
			});
		};
		const { width, height } = parseTextGrids(text, visitor, {
			gridCount: 1,
		});

		if (width !== 9 || height !== 9) {
			throw new Error(`Invalid Sudoku grid size: ${width}x${height}`);
		}

		return new SudokuPuzzle({
			vertexWidth: 9,
			vertexHeight: 9,
			givens,
		});
	}

	public override build(
		context: Context<string>,
		solver: Solver<string>
	): SudokuModel {
		const model = createVertexValueModel(context, solver, this, {
			values: [1, 2, 3, 4, 5, 6, 7, 8, 9] as const,
		});

		const variables = model.variables;
		const varAt = (coord: Point) =>
			variables.get(
				this.grid.getVertex(DoubledGrid.fromVertexIndices(coord))
			) ?? oob(coord);

		const { Distinct } = context;
		for (const given of this.#givens) {
			solver.add(
				varAt(new Point(given.vertex.x, given.vertex.y)).eq(given.value)
			);
		}

		for (let i = 0; i < 9; i++) {
			// Distinct columns
			solver.add(
				Distinct(
					...ensureNonEmpty(
						Array.from({ length: 9 }, (_, j) =>
							varAt(new Point(i, j))
						)
					)
				)
			);
			// Distinct rows
			solver.add(
				Distinct(
					...ensureNonEmpty(
						Array.from({ length: 9 }, (_, j) =>
							varAt(new Point(j, i))
						)
					)
				)
			);
		}

		for (let topIndex = 0; topIndex < 9; topIndex += 3) {
			for (let leftIndex = 0; leftIndex < 9; leftIndex += 3) {
				const blockVars = [];
				for (let i = 0; i < 3; i++) {
					for (let j = 0; j < 3; j++) {
						blockVars.push(
							varAt(new Point(topIndex + i, leftIndex + j))
						);
					}
				}
				// Distinct blocks
				solver.add(Distinct(...ensureNonEmpty(blockVars)));
			}
		}

		return model;
	}
}

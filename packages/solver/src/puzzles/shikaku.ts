import { registerPuzzle } from '../catalog.js';
import {
	CartesianGridPuzzle,
	constant,
	ContextExtended,
	createEdgeIndicatorModel,
	EdgeIndicatorModel,
	EdgeIndicatorSolution,
	GridFace,
	outputFactories,
	parseNumber,
	parseTextGrids,
	type CartesianCoord,
	type CartesianGridPuzzleProps,
	type Solver,
	type TextGridVisitor,
} from '../lib/index.js';

export interface ShikakuPuzzleProps extends CartesianGridPuzzleProps {
	givens: ConstructionGiven[];
}

interface Given {
	face: GridFace;
	/**
	 * Value of the Shikaku cell at this vertex.
	 */
	value: number;
}

/**
 * @remarks
 * Used only prior to constructing a {@link ShikakuPuzzle}.
 *
 * {@link Given} is more convenient to work with once the grid has been constructed.
 */
interface ConstructionGiven {
	coord: CartesianCoord;
	value: number;
}

type ShikakuModel = EdgeIndicatorModel;

type ShikakuSolution = EdgeIndicatorSolution;

export class ShikakuPuzzle extends CartesianGridPuzzle<ShikakuSolution> {
	static {
		registerPuzzle({
			name: 'Shikaku',
			instructions: 'Enter a rectangular grid of numeric cell clues.',
			example: `
.4.........
24..3......
.......[16]...
6524..4....
....25..2.7
..2..24.2..
....[16]......
...........
....[12].6....
2........9.
...........
            `.trim(),
			parser: ShikakuPuzzle,
		});
	}

	#givens: Given[];

	constructor(props: ShikakuPuzzleProps) {
		super(props, outputFactories.vertexOnlyGrid);

		this.#givens = props.givens.map((p) => ({
			face: this.grid.getFace(p.coord),
			value: p.value,
		}));
		for (const { face, value } of this.#givens) {
			if (!face.isInBounds()) {
				throw new Error(`Given at ${face} is out of bounds`);
			}
			this.output.faces.set(face, constant(value));
		}
	}

	/**
	 * @param text Text representation of the Shikaku puzzle grid.
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

		return new ShikakuPuzzle({
			width: width + 1,
			height: height + 1,
			givens,
		});
	}

	public override build(
		context: ContextExtended<string>,
		solver: Solver<string>
	): ShikakuModel {
		const grid = this.grid;
		const { And, Or, Bound, If, SumArray, Not, All, Iff, Sum } = context;

		const model = createEdgeIndicatorModel(context, solver, this);
		const edgeIndicators = model.variables;
		const faceAssignments = context.ints(this.grid.faces(), {
			min: 0,
			max: this.#givens.length - 1,
		});

		// For each given, a variable for its rectangle's size.
		const givenFaces = this.#givens.map((g) => g.face);
		const widths = context.ints(givenFaces, {
			min: 1,
			max: this.grid.width,
		});
		const heights = context.ints(givenFaces, {
			min: 1,
			max: this.grid.height,
		});
		const tops = context.ints(givenFaces, {
			min: 0,
			max: this.grid.height - 1,
		});
		const lefts = context.ints(givenFaces, {
			min: 0,
			max: this.grid.width - 1,
		});

		for (const edge of this.grid.edges()) {
			const edgeVar = edgeIndicators.forceGet(edge);
			if (edge.isOnBoundary()) {
				solver.add(edgeVar.eq(1));
			} else {
				const [a, b] = Array.from(edge.incidentFaces(), (f) =>
					faceAssignments.forceGet(f)
				);
				solver.add(Iff(edgeVar.eq(1), a.neq(b)));
			}
		}

		for (const [i, { face, value }] of this.#givens.entries()) {
			solver.add(faceAssignments.forceGet(face).eq(i));
			// Area matches
			solver.add(
				Or(
					...Array.from(rectangles(value), ([w, h]) =>
						And(
							widths.forceGet(face).eq(w),
							heights.forceGet(face).eq(h)
						)
					)
				)
			);

			const topVar = tops.forceGet(face);
			const leftVar = lefts.forceGet(face);
			const heightVar = heights.forceGet(face);
			const widthVar = widths.forceGet(face);

			// Whatever we assign to top/left/width/height for this rectangle, indicator variables for contained faces must reflect it.
			for (const containedFace of this.grid.faces()) {
				const [x, y] = containedFace.coord;
				solver.add(
					Iff(
						faceAssignments.forceGet(containedFace).eq(i),
						And(
							topVar.le(y),
							Sum(topVar, heightVar).gt(y),
							leftVar.le(x),
							Sum(leftVar, widthVar).gt(x)
						)
					)
				);
			}
		}

		return model;
	}
}

function* rectangles(n: number): Iterable<[number, number]> {
	for (let width = 1; width <= Math.floor(Math.sqrt(n)); width++) {
		if (n % width === 0) {
			const height = n / width;
			yield [width, height];
			yield [height, width];
		}
	}
}

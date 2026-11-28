import { registerPuzzle } from '../catalog.js';
import {
	CartesianGridPuzzle,
	constant,
	ContextExtended,
	createEdgeIndicatorModel,
	EdgeIndicatorModel,
	EdgeIndicatorSolution,
	GridFace,
	oob,
	outputFactories,
	parseTextGrids,
	type CartesianCoord,
	type FaceGridSizeProps,
	type Solver,
	type TextGridVisitor,
} from '../lib/index.js';

export interface TatamibariPuzzleProps extends FaceGridSizeProps {
	givens: ConstructionGiven[];
}

type TatamiChar = '-' | '|' | '+';

interface Given {
	face: GridFace;
	/**
	 * Value of the Tatamibari cell at this vertex.
	 */
	value: TatamiChar;
}

/**
 * @remarks
 * Used only prior to constructing a {@link TatamibariPuzzle}.
 *
 * {@link Given} is more convenient to work with once the grid has been constructed.
 */
interface ConstructionGiven {
	coord: CartesianCoord;
	value: TatamiChar;
}

type TatamibariModel = EdgeIndicatorModel;

type TatamibariSolution = EdgeIndicatorSolution;

export class TatamibariPuzzle extends CartesianGridPuzzle<TatamibariSolution> {
	static {
		registerPuzzle({
			name: 'Tatamibari',
			instructions: 'Enter a rectangular grid of +, -, and | clues.',
			example: `
....-..
..-..|.
.|.....
....-..
.......
..+.|..
.....+.
            `.trim(),
			parser: TatamibariPuzzle,
		});
	}

	#givens: Given[];

	constructor(props: TatamibariPuzzleProps) {
		super(props, outputFactories.vertexOnlyGrid);

		this.#givens = props.givens.map((p) => ({
			face: this.grid.getFace(p.coord),
			value: p.value,
		}));
		const glyphs = {
			'-': 'H',
			'|': 'V',
			'+': '+',
		};
		for (const { face, value } of this.#givens) {
			if (!face.isInBounds()) {
				throw new Error(`Given at ${face} is out of bounds`);
			}
			this.output.faces.set(face, constant(glyphs[value]));
		}
	}

	/**
	 * @param text Text representation of the Tatamibari puzzle grid.
	 */
	public static fromText(text: string) {
		const givens: ConstructionGiven[] = [];
		const visitor: TextGridVisitor = ([char], coord) => {
			givens.push({
				coord,
				value: ['-', '|', '+'].includes(char)
					? (char as TatamiChar)
					: oob(char),
			});
		};
		const { width, height } = parseTextGrids(text, visitor, {
			gridCount: 1,
		});

		return new TatamibariPuzzle({
			faceWidth: width,
			faceHeight: height,
			givens,
		});
	}

	public override build(
		context: ContextExtended<string>,
		solver: Solver<string>
	): TatamibariModel {
		const grid = this.grid;
		const { And, Iff, Sum, AtLeast } = context;

		const model = createEdgeIndicatorModel(context, solver, this);
		const edgeIndicators = model.variables;
		const faceAssignments = context.ints(this.grid.faces(), {
			min: 0,
			max: this.#givens.length - 1,
		});

		const givenFaces = this.#givens.map((g) => g.face);
		// For each given, variables for its rectangle's sizes and positions.
		const faceWidth = this.grid.faceWidth;
		const faceHeight = this.grid.faceHeight;
		const widths = context.ints(givenFaces, {
			min: 1,
			max: faceWidth,
		});
		const heights = context.ints(givenFaces, {
			min: 1,
			max: faceHeight,
		});
		const tops = context.ints(givenFaces, {
			min: 0,
			max: faceHeight - 1,
		});
		const lefts = context.ints(givenFaces, {
			min: 0,
			max: faceWidth - 1,
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

			const topVar = tops.forceGet(face);
			const leftVar = lefts.forceGet(face);
			const heightVar = heights.forceGet(face);
			const widthVar = widths.forceGet(face);

			solver.add(Sum(heightVar, topVar).le(faceHeight));
			solver.add(Sum(widthVar, leftVar).le(faceWidth));

			if (value === '+') {
				solver.add(heightVar.eq(widthVar));
			} else if (value === '|') {
				solver.add(heightVar.gt(widthVar));
			} else {
				solver.add(heightVar.lt(widthVar));
			}

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

		for (const v of grid.vertices()) {
			const incidentFaces = Array.from(v.incidentFaces());
			if (incidentFaces.length === 4) {
				const [a, b, c, d] = incidentFaces.map((f) =>
					faceAssignments.forceGet(f)
				);

				// No four rectangles meet at the same corner.
				solver.add(
					AtLeast(
						[a.eq(b), a.eq(c), a.eq(d), b.eq(c), b.eq(d), c.eq(d)],
						1
					)
				);
			}
		}

		return model;
	}
}

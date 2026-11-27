import { registerPuzzle } from '../catalog.js';
import {
	createFaceValueModel,
	FaceValueModel,
	FaceValueSolution,
} from '../lib/face-value-model.js';
import {
	CartesianGridPuzzle,
	constant,
	isEmptyGridCharacter,
	parseNumber,
	parsePearlColor,
	parseTextGrids,
	type CartesianCoord,
	type CartesianGridPuzzleProps,
	type Solver,
	type TextGridVisitor,
	ContextExtended,
	createForceGetMap,
	GridFace,
	DefaultMap,
	UnionFind,
} from '../lib/index.js';

export interface RippleEffectPuzzleProps extends CartesianGridPuzzleProps {
	givens: ConstructionGiven[];
	polyominoGrid: Map<string, string>;
}

interface Given {
	face: GridFace;
	value: number;
}

/**
 * @remarks
 * Used only prior to constructing a {@link RippleEffectPuzzle}.
 *
 * {@link Given} is more convenient to work with once the grid has been constructed.
 */
interface ConstructionGiven {
	coord: CartesianCoord;
	value: number;
}

function takeSingle<T>(set: Set<T>): T {
	if (set.size !== 1) {
		throw new Error(
			`Expected set to have exactly one element, but got ${set.size}`
		);
	}
	return set.values().next().value!;
}

export class RippleEffectPuzzle extends CartesianGridPuzzle<
	FaceValueSolution<number>
> {
	static {
		registerPuzzle({
			name: 'Ripple Effect',
			instructions:
				'Enter two equally sized grids separated by a blank line. The first grid should have arbitrary characters distinguishing polyomino tiles. The second grid should have any known values for tiles.',
			example: `
AABBAAAAA
ACDBBCBBA
ACCCBCBBB
BBBCAAABA
ACDDAABCC
DCDDBBBCC
DDCCAACCA
BBBBAABAA
AAAABBBAA

........2
.........
.........
.........
....5....
.........
.........
.........
4........
`.trim(),
			parser: RippleEffectPuzzle,
		});
	}

	/**
	 * Note: the indexing model assumes givens are placed go-style.
	 *
	 * If input assume chess/checkers style and indexes accordingly, this does not actually cause a problem (since
	 * it just offsets the grid).
	 *
	 * The solver code works in terms of the natural vertex/edge graph representation when using go style indexing,
	 * which is why having the appropriate mental model is relevant.
	 */
	#givens: Given[];

	#polyominos: UnionFind<GridFace>;
	/**
	 * Maps a polyomino's representative face to all faces that are part of that polyomino.
	 */
	#representatives: DefaultMap<GridFace, GridFace[]> = new DefaultMap(
		() => []
	);

	constructor(props: RippleEffectPuzzleProps) {
		super(props);

		this.#givens = props.givens.map((p) => ({
			face: this.grid.getFace(p.coord),
			value: p.value,
		}));

		const readCharacterGrid = (coord: CartesianCoord) => {
			return props.polyominoGrid.get(JSON.stringify(coord))!;
		};

		this.#polyominos = new UnionFind<GridFace>(this.grid.faces());
		for (const face of this.grid.faces()) {
			const thisChar = readCharacterGrid(face.coord);
			for (const neighbor of face.neighbors()) {
				const neighboringChar = readCharacterGrid(neighbor.coord);
				const neighboringEdges = new Set(
					face.incidentEdges()
				).intersection(new Set(neighbor.incidentEdges()));

				if (thisChar === neighboringChar) {
					// These squares are part of the same polyomino.
					this.#polyominos.union(face, neighbor);
					this.output.edges.set(
						takeSingle(neighboringEdges),
						constant(' ')
					);
				}
			}
		}

		for (const face of this.grid.faces()) {
			const rep = this.#polyominos.find(face);
			this.#representatives.get(rep).push(face);
		}
	}

	/**
	 * @param text Text representation of the RippleEffect puzzle grid.
	 * This should come in the form of two grids: first, the colors grid (B/W), then the lengths (digits) grid.
	 * The grids should be separated by one or more blank lines.
	 * Enclose multi-digit lengths in matching braces, brackets, or parentheses.
	 */
	public static fromText(text: string) {
		const givens: ConstructionGiven[] = [];
		const polyominoGrid = createForceGetMap<string, string>();
		const visitor: TextGridVisitor = ([char, valueChar], coord) => {
			if (!isEmptyGridCharacter(valueChar)) {
				givens.push({
					coord,
					value: parseNumber(valueChar, coord),
				});
			}
			polyominoGrid.set(JSON.stringify(coord), char);
		};
		const { width, height } = parseTextGrids(text, visitor, {
			gridCount: 2,
		});
		return new RippleEffectPuzzle({
			width: width + 1,
			height: height + 1,
			givens,
			polyominoGrid,
		});
	}

	public override build(
		context: ContextExtended<string>,
		solver: Solver<string>
	): FaceValueModel<number> {
		const { Distinct, And, Implies } = context;
		// Number assigned to each face in the grid.
		const model = createFaceValueModel(context, solver, this, {
			values: Array.from(
				{ length: this.grid.width * this.grid.height },
				(_, i) => i + 1
			),
		});

		const { variables } = model;

		// Numbers assigned must agree with the givens.
		for (const given of this.#givens) {
			solver.add(variables.forceGet(given.face).eq(given.value));
		}

		// Each tile must have unique numbers within its polyomino.
		for (const faces of this.#representatives.values()) {
			solver.add(
				Distinct(...faces.map((face) => variables.forceGet(face)))
			);

			for (const face of faces) {
				solver.add(variables.forceGet(face).le(faces.length));
			}
		}

		return model;
	}
}

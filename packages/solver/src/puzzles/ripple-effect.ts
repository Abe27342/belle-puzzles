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
	type FaceGridSizeProps,
	type Solver,
	type TextGridVisitor,
	DoubledGrid,
	ContextExtended,
	createForceGetMap,
	GridFace,
	Point,
	DefaultMap,
	UnionFind,
	ConcreteGraphTypes,
	HasNeighbors,
} from '../lib/index.js';

export interface RippleEffectPuzzleProps extends FaceGridSizeProps {
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
			face: this.grid.getFace(DoubledGrid.fromFaceIndices(p.coord)),
			value: p.value,
		}));

		const readCharacterGrid = (coord: CartesianCoord) => {
			return props.polyominoGrid.get(JSON.stringify(coord))!;
		};

		this.#polyominos = new UnionFind<GridFace>(this.grid.faces());
		for (const face of this.grid.faces()) {
			const thisChar = readCharacterGrid(new Point(face.x, face.y));
			for (const neighbor of face.neighbors()) {
				const neighboringChar = readCharacterGrid(
					new Point(neighbor.x, neighbor.y)
				);
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
			faceWidth: width,
			faceHeight: height,
			givens,
			polyominoGrid,
		});
	}

	public override build(
		context: ContextExtended<string>,
		solver: Solver<string>
	): FaceValueModel<number> {
		const { Distinct, Implies, None } = context;
		// Number assigned to each face in the grid.
		const model = createFaceValueModel(context, solver, this, {
			values: Array.from(
				{ length: this.grid.faceWidth * this.grid.faceHeight },
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
				const faceVar = variables.forceGet(face);
				solver.add(faceVar.le(faces.length));

				// Grid cells assigned the same number cannot be near each other.
				for (
					let assignment = 1;
					assignment <= faces.length;
					assignment++
				) {
					solver.add(
						Implies(
							faceVar.eq(assignment),
							None(
								Array.from(
									nearestStraightLineNeighbors(
										face,
										assignment
									),
									(v) => variables.forceGet(v).eq(assignment)
								)
							)
						)
					);
				}
			}
		}

		return model;
	}
}

/**
 * @returns an iterable of all neighbors that are at most `steps` away from the given vertex.
 */
function* nearestStraightLineNeighbors(
	face: GridFace,
	steps: number
): Iterable<GridFace> {
	for (const edge of face.incidentEdges()) {
		const bearing = edge.bearingFrom(face);
		let currentFace = face;
		for (let step = 0; step < steps; step++) {
			const nextFace = currentFace.translate(bearing);
			if (!nextFace.isInBounds()) {
				break;
			}
			yield nextFace;
			currentFace = nextFace;
		}
	}
}

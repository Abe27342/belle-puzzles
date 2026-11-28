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
	type FaceGridSizeProps,
	type FaceValueModel,
	type FaceValueSolution,
	type GridFace,
	type Context,
	type CreateOutput,
	type GridVertex,
	type Solver,
	type TextGridVisitor,
	type VertexValueModel,
	type VertexValueSolution,
	createFaceValueModel,
	Vector,
	Direction,
	ContextExtended,
} from '../lib/index.js';

export interface ShakashakaPuzzleProps extends FaceGridSizeProps {
	givens: ConstructionGiven[];
}

interface ShakashakaFaceType {
	/**
	 * @returns whether there is a white edge in the provided direction, as interpreted as a ray starting from the center of the face.
	 */
	hasWhiteEdge(direction: Vector): boolean;
	/**
	 * @returns whether there is a black edge in the provided direction, as interpreted as a ray starting from the center of the face.
	 */
	hasBlackEdge(direction: Vector): boolean;

	asCharacter(): string;
}

class WhiteFace implements ShakashakaFaceType {
	public constructor(public readonly name: string) {}
	hasWhiteEdge(direction: Vector): boolean {
		return true;
	}

	hasBlackEdge(direction: Vector): boolean {
		return false;
	}

	public toString() {
		return `white_${this.name}`;
	}
	asCharacter(): string {
		return '□'; // todo: maybe just want space here
	}
}

class BlackFace implements ShakashakaFaceType {
	public constructor(public readonly name: string) {}
	hasWhiteEdge(direction: Vector): boolean {
		return false;
	}

	hasBlackEdge(direction: Vector): boolean {
		return true;
	}

	public toString() {
		return `black_${this.name}`;
	}

	asCharacter(): string {
		return '■';
	}
}

class CornerFace implements ShakashakaFaceType {
	public constructor(private readonly direction: Vector) {}
	hasWhiteEdge(direction: Vector): boolean {
		return direction.dot(this.direction) > 0;
	}

	hasBlackEdge(direction: Vector): boolean {
		return direction.dot(this.direction) < 0;
	}

	public toString() {
		return `corner_${this.asCharacter()}`;
	}

	asCharacter(): string {
		if (this.direction.equals(Direction.NE)) {
			return '◣';
		}
		if (this.direction.equals(Direction.NW)) {
			return '◢';
		}
		if (this.direction.equals(Direction.SE)) {
			return '◤';
		}
		if (this.direction.equals(Direction.SW)) {
			return '◥';
		}

		throw new Error(`Unexpected corner face direction: ${this.direction}`);
	}
}

interface Given {
	face: GridFace;
	/**
	 * Value of the Shakashaka cell at this vertex.
	 *
	 * If undefined, the cell is known to be black but no known adjacent numbers.
	 */
	value?: number;
}

/**
 * @remarks
 * Used only prior to constructing a {@link ShakashakaPuzzle}.
 *
 * {@link Given} is more convenient to work with once the grid has been constructed.
 */
interface ConstructionGiven {
	coord: Point;
	value?: number;
}

type ShakashakaModel = FaceValueModel<number>;

type ShakashakaSolution = FaceValueSolution<number>;

// const sudokuOutput: CreateOutput = (grid) => {
// 	const output = outputFactories.vertexOnlyGrid(grid);
// 	const needsSeparator = (position: number) => (position + 1) % 3 === 0;
// 	for (const edge of grid.edges()) {
// 		const [start, end] = edge.vertices;
// 		const startCoord = start.coord('singleGrid');
// 		const endCoord = end.coord('singleGrid');
// 		const horizontal = startCoord.y === endCoord.y;
// 		const position = horizontal ? startCoord.x : startCoord.y;
// 		const separator = horizontal ? '|' : '-';
// 		output.edges.set(
// 			edge,
// 			constant(needsSeparator(position) ? separator : '')
// 		);
// 	}
// 	for (const face of grid.faces()) {
// 		const [x, y] = face.coord('singleGrid');
// 		const intersection = needsSeparator(x) && needsSeparator(y);
// 		output.faces.set(face, constant(intersection ? '+' : ''));
// 	}
// 	return output;
// };

export class ShakashakaPuzzle extends CartesianGridPuzzle<ShakashakaSolution> {
	static {
		registerPuzzle({
			name: 'Shakashaka',
			instructions:
				'Enter a rectangular grid of numeric shakashaka clues, or "#" for black cells without a known number.',
			example: `
#....
.....
#1.#.
.....
.....
            `.trim(),
			parser: ShakashakaPuzzle,
		});
	}

	#givens: Given[];

	constructor(props: ShakashakaPuzzleProps) {
		super(props);

		this.#givens = props.givens.map((p) => ({
			face: this.grid.getFace(p.coord),
			value: p.value,
		}));
		for (const given of this.#givens) {
			if (!given.face.isInBounds()) {
				throw new Error(`Given at ${given.face} is out of bounds`);
			}
		}
	}

	/**
	 * @param text Text representation of the Shakashaka puzzle grid.
	 */
	public static fromText(text: string) {
		const givens: ConstructionGiven[] = [];
		const visitor: TextGridVisitor = ([value], coord) => {
			givens.push({
				coord,
				value: value === '#' ? undefined : parseNumber(value, coord),
			});
		};
		const { width, height } = parseTextGrids(text, visitor, {
			gridCount: 1,
		});

		return new ShakashakaPuzzle({
			faceWidth: width,
			faceHeight: height,
			givens,
		});
	}

	public override build(
		context: ContextExtended<string>,
		solver: Solver<string>
	): ShakashakaModel {
		const { In, SumArray, If, Exactly, Implies, AtLeast, Or, And } =
			context;
		context.AtLeast;
		// Each cell in the grid is assigned one of these face types.
		// Vertical and diagonal white faces have slightly different constraints, so they are given different assignments.
		const shakashakaCellOptions: ShakashakaFaceType[] = [
			// new WhiteFace('vertical'),
			new WhiteFace('diagonal'),
			new BlackFace('either'),
			new CornerFace(Direction.NW),
			new CornerFace(Direction.NE),
			new CornerFace(Direction.SE),
			new CornerFace(Direction.SW),
		];

		const assignmentsSatisfying = (
			predicate: (cell: ShakashakaFaceType) => boolean
		): number[] => {
			return Array.from(shakashakaCellOptions.entries()).flatMap(
				([index, cell]) => (predicate(cell) ? [index] : [])
			);
		};

		const assignmentSatisfying = (
			predicate: (cell: ShakashakaFaceType) => boolean
		): number => {
			const allValues = assignmentsSatisfying(predicate);
			if (allValues.length > 1) {
				throw new Error('Multiple assignments satisfy the predicate');
			}
			if (allValues.length === 0) {
				throw new Error('No assignment satisfies the predicate');
			}
			return allValues[0];
		};

		const white = assignmentSatisfying((cell) => cell instanceof WhiteFace);
		const black = assignmentSatisfying((cell) => cell instanceof BlackFace);

		const model = createFaceValueModel(context, solver, this, {
			values: shakashakaCellOptions.map((_, i) => i),
			glyphs: shakashakaCellOptions.map((cell) => cell.asCharacter()),
		});

		const faceAssignments = model.variables;

		const blackFaces = new Set<GridFace>();
		for (const { face, value } of this.#givens) {
			solver.add(faceAssignments.forceGet(face).eq(black));
			blackFaces.add(face);

			if (value !== undefined) {
				const neighbors = [...face.neighbors()];
				const neighborsWithBlackCorner = neighbors.map((neighbor) => {
					const neighborVariable = faceAssignments.forceGet(neighbor);
					const neighborToGiven = face.center.subtract(
						neighbor.center
					);
					return If(
						In(
							neighborVariable,
							assignmentsSatisfying(
								(cell) =>
									cell instanceof CornerFace &&
									cell.hasBlackEdge(neighborToGiven)
							)
						),
						1,
						0
					);
				});

				solver.add(SumArray(neighborsWithBlackCorner).eq(value));
			}
		}

		for (const vertex of this.grid.vertices()) {
			const neighborsAreWhite = [...vertex.incidentFaces()].map(
				(neighbor) => {
					const neighborVariable = faceAssignments.forceGet(neighbor);
					return neighborVariable.eq(white);
				}
			);

			solver.add(
				Implies(
					AtLeast(ensureNonEmpty(neighborsAreWhite), 3),
					Exactly(neighborsAreWhite, 4)
				)
			);
		}

		const neverVar = context.Int.const('-1');
		solver.add(context.Bound(neverVar, -1, -1));

		const getFaceVar = (face: GridFace) =>
			faceAssignments.get(face) ?? neverVar;
		for (const face of this.grid.faces()) {
			if (!blackFaces.has(face)) {
				solver.add(faceAssignments.forceGet(face).neq(black));
			}
			// Locally enforce that when you "follow past the corners" on triangular edges, it either continues in the same direction (implying a fully white face)
			// or it turns (implying a corner)

			for (const direction of Direction.interCardinals) {
				// TODO: Enforce that triangles with white corner in this direction satisfy correct properties
				const cardinalPortions = Direction.cardinals.filter(
					(c) => c.dot(direction) > 0
				);

				const assignmentFromDirection = (direction: Vector) => {
					return assignmentSatisfying(
						(cell) =>
							cell.asCharacter() ===
							new CornerFace(direction).asCharacter()
					);
				};

				for (const cardinalPortion of cardinalPortions) {
					const horizontallyAdjacentFace =
						face.translate(cardinalPortion);
					const diagonallyAdjacentFace = face.translate(direction);
					solver.add(
						Implies(
							getFaceVar(face).eq(
								assignmentFromDirection(direction)
							),
							Or(
								// The edge turns on this square.
								getFaceVar(horizontallyAdjacentFace).eq(
									assignmentFromDirection(
										direction.subtract(
											// intercardinals are sqrt(2) factor larger than cardinals, this normalizes
											cardinalPortion.scale(2)
										)
									)
								),
								// The edge continues straight through this square.
								And(
									getFaceVar(diagonallyAdjacentFace).eq(
										white
									),
									getFaceVar(horizontallyAdjacentFace).eq(
										assignmentFromDirection(direction)
									)
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

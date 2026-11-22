// import { CartesianCoord, GridEdge, GridFace } from './graph/index.js';
// import type { Arith, Context, Solver } from './z3.js';
// import {
// 	EdgeIndicatorPuzzleProps,
// 	EdgeIndicatorPuzzle,
// 	EdgeIndicatorRenderOptions,
// } from './edge-indicator-puzzle.js';
// import {
// 	connectedLoopConstraints,
// 	createConstraintExtensions,
// } from './constraint-utils.js';

// export interface CavePuzzleProps extends EdgeIndicatorPuzzleProps {
// 	givens: ConstructionGivens[];
// 	renderOptions?: EdgeIndicatorRenderOptions;
// }

// interface Given {
// 	face: GridFace;
// 	/**
// 	 * Number of faces that can be seen in all cardinal directions from this face
// 	 */
// 	count: number;
// }

// /**
//  * @remarks
//  * Used only prior to constructing a {@link CavePuzzle}.
//  *
//  * {@link Given} is more convenient to work with once the grid has been constructed.
//  */
// interface ConstructionGivens {
// 	coord: CartesianCoord;
// 	/**
// 	 * Number of faces that can be seen in all cardinal directions from this face
// 	 */
// 	count: number;
// }

// export class CavePuzzle extends EdgeIndicatorPuzzle<never, string> {
// 	#givens: Given[];

// 	constructor(props: CavePuzzleProps) {
// 		super(props);

// 		this.#givens = props.givens.map((p) => ({
// 			face: this.grid.getFace(p.coord),
// 			count: p.count,
// 		}));
// 		for (const given of this.#givens) {
// 			if (!given.face.isInBounds()) {
// 				throw new Error(`Given at ${given.face} is out of bounds`);
// 			}
// 			this.faceContents.set(given.face.coord, given.count.toString());
// 		}
// 	}

// 	// ... might be worth adding a csv parser (comma-separated cell values).
// 	// then we could also abstract out a generic text grid parser for similar puzzles.
// 	public static fromTextGrid(
// 		text: string,
// 		renderOptions?: EdgeIndicatorRenderOptions
// 	) {
// 		const lines = text.trim().split('\n');
// 		const height = lines.length;
// 		const width = lines[0].length;
// 		const givens: ConstructionGivens[] = [];
// 		for (let y = 0; y < height; y++) {
// 			for (let x = 0; x < width; x++) {
// 				const char = lines[y][x];
// 				const digit = Number.parseInt(char);
// 				if (!Number.isNaN(digit) && 0 <= digit && digit <= 4) {
// 					givens.push({ coord: [x, y], count: digit });
// 				}
// 			}
// 		}
// 		return new CavePuzzle({
// 			width: width + 1,
// 			height: height + 1,
// 			givens,
// 			renderOptions,
// 		});
// 	}

// 	public override addConstraints(
// 		context: Context<string>,
// 		solver: Solver<string>
// 	): Map<GridEdge, Arith<string>> {
// 		const edgeVariables = this.createEdgeIndicatorVariables(
// 			context,
// 			solver
// 		);

// 		const { Sum, Int, Implies } = context;
// 		const { bound } = createConstraintExtensions(context);

// 		for (const { count, face } of this.#givens) {
// 			// Variables in each direction representing the number of straight-line faces visible from this face,
// 			// including the starting face.
// 			const up = Int.const(`${face}_up`);
// 			const down = Int.const(`${face}_down`);
// 			const left = Int.const(`${face}_left`);
// 			const right = Int.const(`${face}_right`);
// 			const dirMap = {
// 				up,
// 				down,
// 				left,
// 				right,
// 			};

// 			for (const variable of [up, down, left, right]) {
// 				solver.add(bound(variable, 1, count));
// 			}
// 			// We've counted the cell itself 4 times, but the actual count should include it only once.
// 			solver.add(Sum(up, down, left, right).eq(count + 3));

// 			// Bind these variables to the indicator variables.
// 			for (const direction of ['up', 'down', 'left', 'right'] as const) {
// 				const lengthVariable = dirMap[direction];
// 				for (let stepsTaken = 0; stepsTaken < count; stepsTaken++) {
// 					const relevantIndicators = Array.from(
// 						gridUtils.edges.directionalRun(
// 							face.coord,
// 							direction,
// 							stepsTaken + 1
// 						)
// 					);
// 					const [zeroEdge] = relevantIndicators.splice(-1);
// 					const oneEdges = relevantIndicators;
// 					solver.add(
// 						Implies(
// 							lengthVariable.eq(stepsTaken),
// 							And(...oneEdges.map((e) => e.eq(1)), zeroEdge.eq(0))
// 						)
// 					);
// 				}
// 			}

// 			// const adjacentFaceVariables = Array.from(
// 			// 	face.incidentEdges(),
// 			// 	(e) => edgeVariables.get(e) ?? oob(e)
// 			// );
// 			// solver.add(Sum(...ensureNonEmpty(adjacentFaceVariables)).eq(count));
// 		}

// 		// Givens with < 5 must have at least one adjacent edge.
// 		const given = this.#givens.find((g) => g.count < 5);
// 		solver.add(
// 			...connectedLoopConstraints(
// 				edgeVariables,
// 				given?.face.incidentEdges() ?? this.grid.edges(),
// 				context
// 			)
// 		);
// 		return edgeVariables;
// 	}

// 	public override parseAssignment(assignment: string): 0 | 1 {
// 		const value = Number(assignment);
// 		if (value !== 0 && value !== 1) {
// 			throw new Error(`Invalid assignment value: ${value}`);
// 		}
// 		return value;
// 	}
// }

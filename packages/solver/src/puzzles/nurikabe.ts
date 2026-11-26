import { registerPuzzle } from '../catalog.js';
import {
	Arith,
	CartesianGridPuzzle,
	connectedConstraints,
	constant,
	ContextExtended,
	createVertexValueModel,
	outputFactories,
	parseNumber,
	parseTextGrids,
	type CartesianCoord,
	type CartesianGridPuzzleProps,
	type GridVertex,
	type Solver,
	type TextGridVisitor,
	type VertexValueModel,
	type VertexValueSolution,
} from '../lib/index.js';

export interface NurikabePuzzleProps extends CartesianGridPuzzleProps {
	givens: ConstructionGiven[];
}

interface Given {
	vertex: GridVertex;
	/**
	 * Value of the Nurikabe cell at this vertex.
	 */
	value: number;
}

/**
 * @remarks
 * Used only prior to constructing a {@link NurikabePuzzle}.
 *
 * {@link Given} is more convenient to work with once the grid has been constructed.
 */
interface ConstructionGiven {
	coord: CartesianCoord;
	value: number;
}

type NurikabeModel = VertexValueModel<number>;

type NurikabeSolution = VertexValueSolution<number>;

export class NurikabePuzzle extends CartesianGridPuzzle<NurikabeSolution> {
	static {
		registerPuzzle('nurikabe', {
			name: 'Nurikabe',
			instructions: 'Enter a rectangular grid of numeric cell clues.',
			example:
				'2........2\n......2...\n.2..7.....\n..........\n......3.3.\n..2....3..\n2..4......\n..........\n.1....2.4.',
			parser: NurikabePuzzle,
		});
	}

	#givens: Given[];

	constructor(props: NurikabePuzzleProps) {
		super(props, outputFactories.vertexOnlyGrid);

		this.#givens = props.givens.map((p) => ({
			vertex: this.grid.getVertex(p.coord),
			value: p.value,
		}));
		for (const given of this.#givens) {
			if (!given.vertex.isInBounds()) {
				throw new Error(`Given at ${given.vertex} is out of bounds`);
			}
		}
	}

	/**
	 * @param text Text representation of the Nurikabe puzzle grid.
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

		return new NurikabePuzzle({
			width,
			height,
			givens,
		});
	}

	public override build(
		context: ContextExtended<string>,
		solver: Solver<string>
	): NurikabeModel {
		const grid = this.grid;
		const { And, Or, Bound, If, SumArray, Not, All } = context;

		const islandIds = Array.from(
			{ length: this.#givens.length + 1 },
			(_, i) => i
		);
		const model = createVertexValueModel(context, solver, this, {
			values: islandIds,
			glyphs: Array.from({ length: islandIds.length }, (_, i) =>
				i === this.#givens.length ? '#' : '.'
			),
		});

		for (const { vertex, value } of this.#givens) {
			model.output.vertices.set(vertex, constant(value));
		}

		// vertex is assigned to island i iff it is part of the island at this.#givens[i].
		const islandAssignments = model.variables;
		const isSea = (v: Arith<string>) => v.eq(this.#givens.length);

		let max = 0;
		const givenVertices = new Map<GridVertex, Given>();
		for (const [i, given] of this.#givens.entries()) {
			givenVertices.set(given.vertex, given);
			max = Math.max(max, given.value);
			solver.add(islandAssignments.forceGet(given.vertex).eq(i));

			const verticesWithThisAssignment = Array.from(
				grid.vertices(),
				(v) => If(islandAssignments.forceGet(v).eq(i), 1, 0)
			);
			solver.add(SumArray(verticesWithThisAssignment).eq(given.value));
		}

		// Individual givens do not force an obvious vertex that we can pick as a guaranteed member of the sea.
		// We make a basic effort here to speed up solving by using the trivial deduction that any vertex with multiple adjacent
		// non-sea givens must be part of the sea (as else those two would be connected without a separating sea cell)
		let simplyDeducedSea: GridVertex[] | undefined = undefined;
		for (const vertex of grid.vertices()) {
			let adjacentClues = 0;
			for (const neighbor of vertex.neighbors()) {
				if (givenVertices.has(neighbor)) {
					adjacentClues++;
				}
			}
			if (adjacentClues > 1) {
				simplyDeducedSea = [vertex];
				break;
			}
		}

		// Sea is connected.
		solver.add(
			...connectedConstraints(
				context,
				islandAssignments,
				simplyDeducedSea ?? grid.vertices(),
				isSea
			)
		);

		// Sea does not have 2x2 squares
		for (const face of grid.faces()) {
			solver.add(
				Not(
					All(
						Array.from(face.incidentVertices(), (v) =>
							isSea(islandAssignments.forceGet(v))
						)
					)
				)
			);
		}

		const distanceToRoot = context.ints(grid.vertices(), {
			min: 0,
			max,
			name: 'distanceToRoot',
		});

		for (const vertex of grid.vertices()) {
			const distance = distanceToRoot.forceGet(vertex);
			// Givens are at distance 0.
			// All others have distance greater than 0 and at least one neighbor with a smaller distance.
			if (givenVertices.has(vertex)) {
				solver.add(distance.eq(0));
			} else {
				solver.add(Bound(distance, 1, max));
				solver.add(
					Or(
						isSea(islandAssignments.forceGet(vertex)),
						...Array.from(vertex.neighbors()).map((neighbor) =>
							And(
								islandAssignments
									.forceGet(neighbor)
									.eq(islandAssignments.forceGet(vertex)),
								distanceToRoot.forceGet(neighbor).lt(distance)
							)
						)
					)
				);
			}
		}

		for (const edge of grid.edges()) {
			const [a, b] = edge.vertices.map((v) =>
				islandAssignments.forceGet(v)
			);
			solver.add(Or(a.eq(b), isSea(a), isSea(b)));
		}

		return model;
	}
}

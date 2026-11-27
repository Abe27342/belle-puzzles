import { registerPuzzle } from '../catalog.js';
import {
	CartesianGridPuzzle,
	constant,
	createEdgeIndicatorModel,
	parseNumber,
	parseTextGrids,
	type CartesianCoord,
	type VertexGridSizeProps,
	type EdgeIndicatorModel,
	type EdgeIndicatorSolution,
	type Solver,
	type TextGridVisitor,
	ContextExtended,
	GridVertex,
	createForceGetMap,
	getOrCreate,
	connectedConstraints,
	Counter,
} from '../lib/index.js';

export interface NumberlinkPuzzleProps extends VertexGridSizeProps {
	givens: ConstructionGivens[];
}

interface Given {
	vertex: GridVertex;
	/**
	 * The number assigned to this vertex.
	 */
	assignment: number;
}

/**
 * @remarks
 * Used only prior to constructing a {@link NumberlinkPuzzle}.
 *
 * {@link Given} is more convenient to work with once the grid has been constructed.
 */
interface ConstructionGivens {
	coord: CartesianCoord;
	/**
	 * The number assigned to this vertex.
	 */
	assignment: number;
}

export class NumberlinkPuzzle extends CartesianGridPuzzle<EdgeIndicatorSolution> {
	static {
		registerPuzzle({
			name: 'Numberlink',
			instructions: 'Enter a rectangular grid of paired cell clues.',
			example:
				'...4...\n.3..25.\n...31..\n...5...\n.......\n..1....\n2...4..',
			parser: NumberlinkPuzzle,
		});
	}

	#pathToVertices: Map<number, GridVertex[]> = createForceGetMap();
	#givens: Given[];
	#givenVertices: Set<GridVertex> = new Set();

	constructor(props: NumberlinkPuzzleProps) {
		super(props);

		this.#givens = props.givens.map((p) => ({
			vertex: this.grid.getVertex(p.coord),
			assignment: p.assignment,
		}));
		const assignmentCounts = new Counter<number>();
		for (const given of this.#givens) {
			assignmentCounts.increment(given.assignment);
			if (!given.vertex.isInBounds()) {
				throw new Error(`Given at ${given.vertex} is out of bounds`);
			}
			this.output.vertices.set(given.vertex, constant(given.assignment));
			getOrCreate(this.#pathToVertices, given.assignment, () => []).push(
				given.vertex
			);
			this.#givenVertices.add(given.vertex);
		}

		for (const [assignment, count] of assignmentCounts) {
			if (count !== 2) {
				throw new Error(
					`Numberlink assignment ${assignment} must appear exactly twice`
				);
			}
		}
	}

	public static fromText(text: string) {
		const givens: ConstructionGivens[] = [];
		const visitor: TextGridVisitor = ([char], coord) => {
			givens.push({ coord, assignment: parseNumber(char, coord) });
		};
		const { width, height } = parseTextGrids(text, visitor, {
			gridCount: 1,
		});
		return new NumberlinkPuzzle({
			vertexWidth: width,
			vertexHeight: height,
			givens,
		});
	}

	private get uniquePathCount() {
		return this.#givens.length / 2;
	}

	public override build(
		context: ContextExtended<string>,
		solver: Solver<string>
	): EdgeIndicatorModel {
		const model = createEdgeIndicatorModel(context, solver, this);
		const edgeVariables = model.variables;

		const pathAssignments = context.ints(this.grid.vertices(), {
			min: 0,
			max: this.uniquePathCount - 1,
		});

		// Each path should have all its vertices assigned to the same group.
		const pathEntries = Array.from(this.#pathToVertices.values());
		for (let i = 0; i < this.uniquePathCount; i++) {
			const vertices = pathEntries[i];
			for (const vertex of vertices) {
				solver.add(pathAssignments.forceGet(vertex).eq(i));
			}

			// All vertices assigned to this path must be connected.
			solver.add(
				...connectedConstraints(
					context,
					pathAssignments,
					[vertices[0]],
					(v) => v.eq(i)
				)
			);
		}

		const { Implies } = context;
		// Edges connecting two vertices imply that the vertices belong to the same path.
		for (const edge of this.grid.edges()) {
			const [a, b] = edge.vertices.map((v) =>
				pathAssignments.forceGet(v)
			);
			solver.add(Implies(edgeVariables.forceGet(edge).eq(1), a.eq(b)));
		}

		const graphConstraints = context.graphConstraints(this.grid);
		for (const vertex of this.grid.vertices()) {
			const degree = graphConstraints.degree(vertex, edgeVariables);
			if (this.#givenVertices.has(vertex)) {
				solver.add(degree.eq(1));
			} else {
				// TODO: Wikipedia mentions not all variants of numberlink enforce all vertices are used.
				// This should be possible to implement by relaxing this constraint to allow degree 0.
				// If doing this, probably makes sense to update the parser to include a config object
				// so that the person using the solver can say whether or not they want the constraint that all cells are used.
				solver.add(degree.eq(2));
			}
		}

		return model;
	}
}

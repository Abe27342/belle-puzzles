import { registerPuzzle } from '../catalog.js';
import {
	CartesianGridGraph,
	CartesianGridPuzzle,
	constant,
	ContextExtended,
	createVertexValueModel,
	ensureNonEmpty,
	parseNumber,
	parseTextGrids,
	variable,
	type CartesianCoord,
	type CartesianGridPuzzleProps,
	type GridVertex,
	type Solver,
	type TextGridVisitor,
	type VertexValueModel,
	type VertexValueSolution,
} from '../lib/index.js';

export interface FillominoPuzzleProps extends CartesianGridPuzzleProps {
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
 * Used only prior to constructing a {@link FillominoPuzzle}.
 *
 * {@link Given} is more convenient to work with once the grid has been constructed.
 */
interface ConstructionGiven {
	coord: CartesianCoord;
	value: number;
}

type FillominoModel = VertexValueModel<number>;

type FillominoSolution = VertexValueSolution<number>;

export class FillominoPuzzle extends CartesianGridPuzzle<FillominoSolution> {
	static {
		registerPuzzle('fillomino', {
			name: 'Fillomino',
			instructions: 'Enter a rectangular grid of numeric cell clues.',
			example:
				'...3 .   ...5\n..83[10] ..5.\n.3.. .   44..\n13.3 .   .2..\n.2.. 3   ..2.\n..2. .   3.13\n..44 .   ..3.\n.4.. 4   33..\n6... .   1...',
			parser: FillominoPuzzle,
		});
	}

	#givens: Given[];
	#cellGrid: CartesianGridGraph;

	constructor(props: FillominoPuzzleProps) {
		super({
			...props,
			width: props.width + 1,
			height: props.height + 1,
		});

		this.#cellGrid = new CartesianGridGraph(props);
		this.#givens = props.givens.map((p) => ({
			vertex: this.#cellGrid.getVertex(p.coord),
			value: p.value,
		}));
		for (const given of this.#givens) {
			if (!given.vertex.isInBounds()) {
				throw new Error(`Given at ${given.vertex} is out of bounds`);
			}
		}
	}

	/**
	 * @param text Text representation of the Fillomino puzzle grid.
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

		return new FillominoPuzzle({
			width,
			height,
			givens,
		});
	}

	public override build(
		context: ContextExtended<string>,
		solver: Solver<string>
	): FillominoModel {
		const grid = this.#cellGrid;
		const max = grid.width * grid.height;
		const model = createVertexValueModel(
			context,
			solver,
			{ grid, output: this.output },
			{
				values: Array.from({ length: max }, (_, i) => i + 1),
			}
		);
		const { Implies, Iff } = context;

		// Idea behind constraints:
		// - Each region is given a spanning tree. WLOG, the minimum index vertex is chosen to be the root.
		// - Region sizes can be enforced via local constraints by summing outdegrees of children in that spanning tree
		// - Each vertex is associated with the root of its component, which allows enforcing adjacent cells are only given
		//   the same number when they are part of the same component.
		const vertexNumbers = model.variables;
		const graphConstraints = context.graphConstraints(grid);
		const { edgeIndicators, subtreeSizes, rootAssignments } =
			graphConstraints.treeStructureVariables();

		// Solution agrees with provided constraints.
		for (const { vertex, value } of this.#givens) {
			solver.add(vertexNumbers.forceGet(vertex).eq(value));
		}

		const inDegree = (v: GridVertex) =>
			graphConstraints.inDegree(v, edgeIndicators);

		for (const vertex of grid.vertices()) {
			solver.add(
				// The root of the tree must have its vertex count equal to its assigned number in the fillomino grid.
				Implies(
					inDegree(vertex).eq(0),
					subtreeSizes
						.forceGet(vertex)
						.eq(vertexNumbers.forceGet(vertex))
				)
			);
		}

		for (const edge of grid.directedEdges()) {
			solver.add(
				// All vertices that are part of the same tree must be assigned the same number in the fillomino grid.
				Implies(
					edgeIndicators.forceGet(edge).eq(1),
					vertexNumbers
						.forceGet(edge.from)
						.eq(vertexNumbers.forceGet(edge.to))
				),
				// If two adjacent cells have the same number in the grid, they also have the same tree root.
				Implies(
					vertexNumbers
						.forceGet(edge.from)
						.eq(vertexNumbers.forceGet(edge.to)),
					rootAssignments
						.forceGet(edge.from)
						.eq(rootAssignments.forceGet(edge.to))
				)
			);
		}

		// Render fillomino values in faces
		for (const [vertex, binding] of model.output.vertices) {
			model.output.faces.set(this.grid.getFace(vertex.coord), binding);
		}
		model.output.vertices.clear();
		for (const vertex of this.grid.vertices()) {
			model.output.vertices.set(vertex, constant('·'));
		}
		for (const edge of this.grid.edges()) {
			const [start, end] = edge.vertices;
			const horizontal = start.y === end.y;
			const glyph = horizontal ? '-' : '|';
			const first = vertexNumbers.get(
				grid.getVertex(
					horizontal ? [start.x, start.y - 1] : [start.x - 1, start.y]
				)
			);
			const second = vertexNumbers.get(grid.getVertex(start.coord));
			model.output.edges.set(
				edge,
				first === undefined || second === undefined
					? constant(glyph)
					: variable(
							first.neq(second),
							(assignment) => context.isTrue(assignment),
							(boundary) => (boundary ? glyph : ' ')
					  )
			);
		}
		return model;
	}
}

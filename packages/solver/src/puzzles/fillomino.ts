import { registerPuzzle } from '../catalog.js';
import {
	Arith,
	CartesianGridPuzzle,
	createVertexValueModel,
	ensureNonEmpty,
	oob,
	parseBase36Digit,
	parseTextGrids,
	type CartesianCoord,
	type CartesianGridPuzzleProps,
	type CartesianGridRenderOptions,
	type Context,
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
			instructions:
				'Enter a rectangular grid of single-digit cell clues. Clues are parsed in base36 (a=10, b=11, etc).',
			example:
				'...3....5\n..83a..5.\n.3...44..\n13.3..2..\n.2..3..2.\n..2..3.13\n..44...3.\n.4..433..\n6....1...',
			parser: FillominoPuzzle,
		});
	}

	#givens: Given[];

	constructor(props: FillominoPuzzleProps) {
		super({
			...props,
			renderOptions: {
				horizontal: '-',
				vertical: '|',
				...props.renderOptions,
			},
		});

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
	 * @param text Text representation of the Fillomino puzzle grid.
	 */
	public static fromText(
		text: string,
		renderOptions?: Partial<CartesianGridRenderOptions>
	) {
		const givens: ConstructionGiven[] = [];
		const visitor: TextGridVisitor = ([value], coord) => {
			givens.push({
				coord,
				value: parseBase36Digit(value, coord),
			});
		};
		const { width, height } = parseTextGrids(text, visitor, {
			gridCount: 1,
		});

		return new FillominoPuzzle({
			width,
			height,
			givens,
			renderOptions,
		});
	}

	public override build(
		context: Context<string>,
		solver: Solver<string>
	): FillominoModel {
		const max = this.grid.width * this.grid.height;
		const model = createVertexValueModel(context, solver, this, {
			// The 36 here means no region larger than size 36 will ever be considered.
			values: Array.from({ length: 36 }, (_, i) => i),
			glyphs: '0123456789abcdefghijklmnopqrstuvwxyz'.split(''),
		});
		const { Not, And, Sum, Implies, If } = context;

		// Idea behind constraints:
		// - Each region is given a spanning tree. WLOG, the minimum index vertex is chosen to be the root.
		// - Region sizes can be enforced via local constraints by summing outdegrees of children in that spanning tree
		// - Each vertex is associated with the root of its component, which allows enforcing adjacent cells are only given
		//   the same number when they are part of the same component.
		const vertexNumbers = model.variables;

		const inDegree = (v: GridVertex) =>
			Sum(
				...ensureNonEmpty(
					[...v.neighbors()].map((n) =>
						treeIndicators.forceGet(this.grid.getDirectedEdge(n, v))
					)
				)
			);

		// Solution agrees with provided constraints.
		for (const { vertex, value } of this.#givens) {
			solver.add(vertexNumbers.forceGet(vertex).eq(value));
		}

		// Now we need directed edge variables...
		const treeIndicators = createVariableMap(
			context,
			'edgePresence',
			this.grid.directedEdges(),
			(variable) => {
				solver.add(variable.ge(0).and(variable.le(1)));
			}
		);

		// Enforce the indicator variables form a tree.
		for (const edge of this.grid.directedEdges()) {
			// At most one of an edge and its inversion can be enabled.
			solver.add(
				Not(
					And(
						...[edge, edge.invert()].map((e) =>
							treeIndicators.forceGet(e).eq(1)
						)
					)
				)
			);

			solver.add(inDegree(edge.to).le(1));
		}

		// Number of vertices in the subtree rooted at each vertex.
		const subtreeCounts = createVariableMap(
			context,
			'rootedSubtreeSize',
			this.grid.vertices(),
			(variable) => {
				solver.add(variable.ge(1).and(variable.le(max)));
			}
		);

		for (const vertex of this.grid.vertices()) {
			const neighbors = [...vertex.neighbors()];
			solver.add(
				subtreeCounts.forceGet(vertex).eq(
					// Conditionally summing over all neighbors that are assigned to the same cluster
					// is achieved via the classic trick of summing over all neighbors, but multiplying by the indicator function
					// over whether the edge to that neighbor is part of the tree.
					Sum(
						...ensureNonEmpty(
							neighbors.map((v) => {
								const outgoingEdge = treeIndicators.forceGet(
									this.grid.getDirectedEdge(vertex, v)
								);
								return If(
									outgoingEdge.eq(1),
									subtreeCounts.forceGet(v),
									0
								);
							})
						)
					).add(1)
				)
			);
		}

		const rootAssignments = createVariableMap(
			context,
			'rootOf',
			this.grid.vertices(),
			(variable) => {
				solver.add(variable.ge(0).and(variable.lt(max)));
			}
		);

		for (const vertex of this.grid.vertices()) {
			const [x, y] = vertex.coord;
			const flattenedVertexIndex = y * this.grid.width + x;
			solver.add(
				// Each root vertex is identified by its flattened index.
				Implies(
					inDegree(vertex).eq(0),
					rootAssignments.forceGet(vertex).eq(flattenedVertexIndex)
				),
				// Use the lowest possible index for each root. This is not a necessary constraint for correctness, but it
				// vastly reduces the search space and is necessary in practice.
				rootAssignments.forceGet(vertex).le(flattenedVertexIndex),
				// The root of the tree must have its vertex count equal to its assigned number in the fillomino grid.
				Implies(
					inDegree(vertex).eq(0),
					subtreeCounts
						.forceGet(vertex)
						.eq(vertexNumbers.forceGet(vertex))
				)
			);
		}

		for (const edge of this.grid.directedEdges()) {
			solver.add(
				// All vertices that are part of the same tree must be assigned the same unique root.
				Implies(
					treeIndicators.forceGet(edge).eq(1),
					rootAssignments
						.forceGet(edge.from)
						.eq(rootAssignments.forceGet(edge.to))
				),
				// All vertices that are part of the same tree must be assigned the same number in the fillomino grid.
				Implies(
					treeIndicators.forceGet(edge).eq(1),
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

		return model;
	}
}

function createVariableMap<TKey>(
	context: Context<string>,
	prefix: string,
	keys: Iterable<TKey>,
	constrain: (variable: Arith<string>) => void
): Map<TKey, Arith<string>> & {
	forceGet(key: TKey): Arith<string>;
} {
	const map = new Map<TKey, Arith<string>>() as Map<TKey, Arith<string>> & {
		forceGet(key: TKey): Arith<string>;
	};
	for (const key of keys) {
		const variable = context.Int.const(`${prefix}_${key}`);
		constrain(variable);
		map.set(key, variable);
	}
	map.forceGet = (key: TKey) => {
		return map.get(key) ?? oob(key);
	};
	return map;
}

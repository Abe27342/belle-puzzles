import { registerPuzzle } from '../catalog.js';
import {
	CartesianGridPuzzle,
	ContextExtended,
	constant,
	type FaceValueSolution,
	outputFactories,
	type CartesianGridPuzzleProps,
	type GridEdge,
	type GridFace,
	type GridVertex,
	type Solver,
	parseDoubledResolutionGrid,
	TextGridVisitor,
	CartesianCoord,
	connectedConstraints,
	createEdgeIndicatorModel,
	oob,
	variable,
	type BuiltPuzzle,
	type CartesianGraphTypes,
} from '../lib/index.js';

export interface SpiralGalaxiesPuzzleProps extends CartesianGridPuzzleProps {
	pearls: ConstructionSpiralGalaxyPearl[];
}

export interface ConstructionSpiralGalaxyPearl {
	type: 'face' | 'edge' | 'vertex';
	coord: CartesianCoord;
}

export type SpiralGalaxyPearl =
	| { type: 'face'; face: GridFace; center: CartesianCoord }
	| { type: 'edge'; edge: GridEdge; center: CartesianCoord }
	| { type: 'vertex'; vertex: GridVertex; center: CartesianCoord };

type SpiralGalaxiesModel = BuiltPuzzle<
	CartesianGraphTypes,
	SpiralGalaxiesSolution
>;
type SpiralGalaxiesSolution = FaceValueSolution<number>;

export class SpiralGalaxiesPuzzle extends CartesianGridPuzzle<SpiralGalaxiesSolution> {
	static {
		registerPuzzle({
			name: 'Spiral Galaxies',
			gridFormat: 'double-resolution',
			instructions: 'Use "o" for pearls.',
			example: `
·-·-·-·-·-·-·-·-·-·-·
|#o#|#|#|#|#|o|#|#|#|
·-·-·-·-·-·-·-·-·-·-·
|o|#|o|#|#|#|#|#|o|#|
·-·-·-·-·o·-o-·-·-·-·
|#|#|#|#|#|#|#|#|#|#|
·-·-·-·-·-·-·-·-·-·-·
|#|#|#|#|#|#|#|#|#|o|
·-·-·-·-·-·o·-·-·-·-·
|#|o|o|o|#|#|#|#|#|#|
·-·-·-·-·-·-·-o-·-·-·
|#|#|#|#|#|#|#|#|#o#|
·-·-·-·-·-·-·-·-·-·-·
|#|#|#|#|#|#o#|#|#|#|
·-·-·-·-·-·-·-·-·-·-·
|#|#|#|#|#|#|#|#|#|#|
·-o-·-·o·-·-·-o-·-·o·
|#|#|#|#|#|#|#|#|#|#|
·-·-·-·-·-·-·-·-·-·-·
|o|#|o|o|#|o|#|o|o|#|
·-·-·-·-·-·-·-·-·-·-·
`.trim(),
			parser: SpiralGalaxiesPuzzle,
		});
	}

	#pearls: SpiralGalaxyPearl[];

	constructor(props: SpiralGalaxiesPuzzleProps) {
		super(props, outputFactories.linedGrid);

		this.#pearls = props.pearls.map((pearl) => {
			if (pearl.type === 'face') {
				return {
					type: 'face',
					face: this.grid.getFace([
						(pearl.coord[0] - 1) / 2,
						(pearl.coord[1] - 1) / 2,
					]),
					center: [pearl.coord[0] / 2, pearl.coord[1] / 2],
				};
			}
			if (pearl.type === 'edge') {
				const [x, y] = pearl.coord;
				if (x % 2 === 1) {
					const left = this.grid.getVertex([
						Math.floor(x / 2),
						y / 2,
					]);
					return {
						type: 'edge',
						edge: this.grid.getEdge(left, left.right),
						center: [x / 2, y / 2],
					};
				}
				const top = this.grid.getVertex([x / 2, Math.floor(y / 2)]);
				return {
					type: 'edge',
					edge: this.grid.getEdge(top, top.down),
					center: [x / 2, y / 2],
				};
			}
			return {
				type: 'vertex',
				vertex: this.grid.getVertex([
					pearl.coord[0] / 2,
					pearl.coord[1] / 2,
				]),
				center: [pearl.coord[0] / 2, pearl.coord[1] / 2],
			};
		});

		for (const pearl of this.#pearls) {
			if (pearl.type === 'edge') {
				this.output.edges.set(pearl.edge, constant('o'));
			} else if (pearl.type === 'vertex') {
				this.output.vertices.set(pearl.vertex, constant('o'));
			} else {
				this.output.faces.set(pearl.face, constant('o'));
			}
		}
	}

	public static fromText(text: string) {
		const { width: faceWidth, height: faceHeight } =
			parseDoubledResolutionGrid(text, {});
		const pearls: ConstructionSpiralGalaxyPearl[] = [];
		const validateChar = (visitor: TextGridVisitor): TextGridVisitor => {
			return (values, coord) => {
				const [value] = values;
				if (value.toLowerCase() !== 'o') {
					throw new Error(`Invalid character at ${coord}: ${value}`);
				}
				return visitor(values, coord);
			};
		};
		parseDoubledResolutionGrid(text, {
			faces: validateChar((_, [x, y]) => {
				pearls.push({
					type: 'face',
					coord: [x, y],
				});
			}),
			edges: validateChar((_, [x, y]) => {
				pearls.push({ type: 'edge', coord: [x, y] });
			}),
			vertices: validateChar((_, [x, y]) => {
				pearls.push({
					type: 'vertex',
					coord: [x, y],
				});
			}),
		});

		return new SpiralGalaxiesPuzzle({
			width: faceWidth + 1,
			height: faceHeight + 1,
			pearls,
		});
	}

	public override build(
		context: ContextExtended<string>,
		solver: Solver<string>
	): SpiralGalaxiesModel {
		const pearlFaces = new Set(
			this.#pearls
				.filter(
					(
						pearl
					): pearl is Extract<SpiralGalaxyPearl, { type: 'face' }> =>
						pearl.type === 'face'
				)
				.map((pearl) => pearl.face)
		);
		const faceAssignments = context.ints(this.grid.faces(), {
			min: 0,
			max: Math.max(0, this.#pearls.length - 1),
			name: 'faceAssignment',
		});
		for (const face of this.grid.faces()) {
			if (pearlFaces.has(face)) {
				this.output.faces.set(face, constant('o'));
			} else {
				this.output.faces.set(
					face,
					variable(
						faceAssignments.forceGet(face),
						() => undefined,
						() => ' '
					)
				);
			}
		}

		const edgeModel = createEdgeIndicatorModel(context, solver, this);
		for (const edge of this.grid.edges()) {
			const [a, b] = Array.from(edge.incidentFaces());
			const edgeIndicator = edgeModel.variables.forceGet(edge);
			if (edge.isOnBoundary()) {
				solver.add(edgeIndicator.eq(0));
			} else {
				solver.add(
					context.Iff(
						edgeIndicator.eq(1),
						faceAssignments
							.forceGet(a)
							.neq(faceAssignments.forceGet(b))
					)
				);
			}
			this.output.edges.set(
				edge,
				variable(
					edgeIndicator,
					(assignment) => Number(assignment.toString()),
					(value) =>
						value === 1 ? (edge.isHorizontal ? '-' : '|') : ' '
				)
			);
		}
		for (const pearl of this.#pearls) {
			if (pearl.type === 'edge') {
				this.output.edges.set(pearl.edge, constant('o'));
			} else if (pearl.type === 'vertex') {
				this.output.vertices.set(pearl.vertex, constant('o'));
			}
		}

		for (const [i, pearl] of this.#pearls.entries()) {
			const minimalEnabled: GridFace[] = [];
			if (pearl.type === 'face') {
				minimalEnabled.push(pearl.face);
				solver.add(faceAssignments.forceGet(pearl.face).eq(i));
			} else if (pearl.type === 'edge') {
				minimalEnabled.push(...pearl.edge.incidentFaces());
				for (const face of pearl.edge.incidentFaces()) {
					solver.add(faceAssignments.forceGet(face).eq(i));
				}
			} else if (pearl.type === 'vertex') {
				minimalEnabled.push(...pearl.vertex.incidentFaces());
				for (const face of pearl.vertex.incidentFaces()) {
					solver.add(faceAssignments.forceGet(face).eq(i));
				}
			}
			// Faces assigned to this pearl must be connected
			solver.add(
				...connectedConstraints(
					context,
					faceAssignments,
					minimalEnabled,
					(variable) => variable.eq(i)
				)
			);

			const [a, b] = pearl.center;
			for (const face of this.grid.faces()) {
				const [x, y] = face.center;
				const reflected: CartesianCoord = [2 * a - x, 2 * b - y];
				const reflectedFace = this.grid.getFromCenter(reflected);
				if (reflectedFace.type !== 'face') {
					throw new Error(
						`Reflected coordinate ${reflected} does not correspond to a face`
					);
				}

				if (reflectedFace.isInBounds()) {
					solver.add(
						context.Iff(
							faceAssignments.forceGet(face).eq(i),
							faceAssignments.forceGet(reflectedFace).eq(i)
						)
					);
				} else {
					solver.add(faceAssignments.forceGet(face).neq(i));
				}
			}
		}

		return {
			output: this.output,
			keyAssignments: [...faceAssignments.values()],
			decodeSolution(model) {
				return new Map(
					Array.from(faceAssignments, ([face, expression]) => [
						face,
						Number(model.eval(expression, true).toString()),
					])
				);
			},
		};
	}
}

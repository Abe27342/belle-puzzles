import { registerPuzzle } from '../catalog.js';
import {
	CartesianGridPuzzle,
	ContextExtended,
	constant,
	type EdgeValueSolution,
	outputFactories,
	type FaceGridSizeProps,
	type GridEdge,
	type GridFace,
	type GridVertex,
	type Solver,
	parseDoubledResolutionGrid,
	TextGridVisitor,
	Point,
	connectedConstraints,
	createEdgeIndicatorModel,
	oob,
	variable,
	type BuiltPuzzle,
	type CartesianGraphTypes,
} from '../lib/index.js';

export interface SpiralGalaxiesPuzzleProps extends FaceGridSizeProps {
	pearls: ConstructionSpiralGalaxyPearl[];
}

export interface ConstructionSpiralGalaxyPearl {
	coord: Point;
}

export type SpiralGalaxyPearl = GridFace | GridEdge | GridVertex;

type SpiralGalaxiesModel = BuiltPuzzle<
	CartesianGraphTypes,
	SpiralGalaxiesSolution
>;
type SpiralGalaxiesSolution = EdgeValueSolution<number>;

export class SpiralGalaxiesPuzzle extends CartesianGridPuzzle<SpiralGalaxiesSolution> {
	static {
		registerPuzzle({
			name: 'Spiral Galaxies',
			aliases: ['Tentai Show', 'Tentaisho', 'Galaxies', 'Sym-a-Pix'],
			gridFormat: 'double-resolution',
			instructions: 'Use "o" for givens.',
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
			return this.grid.getFromCenter(pearl.coord);
		});
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
					coord: new Point(x, y),
				});
			}),
			edges: validateChar((_, [x, y]) => {
				pearls.push({ coord: new Point(x, y) });
			}),
			vertices: validateChar((_, [x, y]) => {
				pearls.push({
					coord: new Point(x, y),
				});
			}),
		});

		return new SpiralGalaxiesPuzzle({
			faceWidth,
			faceHeight,
			pearls,
		});
	}

	public override build(
		context: ContextExtended<string>,
		solver: Solver<string>
	): SpiralGalaxiesModel {
		const faceAssignments = context.ints(this.grid.faces(), {
			min: 0,
			max: this.#pearls.length - 1,
			name: 'faceAssignment',
		});

		const model = createEdgeIndicatorModel(context, solver, this);
		for (const edge of this.grid.edges()) {
			const [a, b] = Array.from(edge.incidentFaces());
			const edgeIndicator = model.variables.forceGet(edge);
			if (edge.isOnBoundary()) {
				solver.add(edgeIndicator.eq(1));
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
		}

		// Do this after creating the model so that rendering pearls takes precedence over edge indicators.
		for (const pearl of this.#pearls) {
			if (pearl.type === 'edge') {
				model.output.edges.set(pearl, constant('o'));
			} else if (pearl.type === 'vertex') {
				model.output.vertices.set(pearl, constant('o'));
			} else {
				model.output.faces.set(pearl, constant('o'));
			}
		}

		for (const [i, pearl] of this.#pearls.entries()) {
			const minimalEnabled: GridFace[] = [];
			if (pearl.type === 'face') {
				minimalEnabled.push(pearl);
				solver.add(faceAssignments.forceGet(pearl).eq(i));
			} else if (pearl.type === 'edge') {
				minimalEnabled.push(...pearl.incidentFaces());
				for (const face of pearl.incidentFaces()) {
					solver.add(faceAssignments.forceGet(face).eq(i));
				}
			} else if (pearl.type === 'vertex') {
				minimalEnabled.push(...pearl.incidentFaces());
				for (const face of pearl.incidentFaces()) {
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

			for (const face of this.grid.faces()) {
				const reflected = face.center.reflectAcross(pearl.center);
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

		return model;
	}
}

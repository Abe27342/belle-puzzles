import { registerPuzzle } from '../catalog.js';
import {
	CartesianGridPuzzle,
	ContextExtended,
	CartesianGridGraph,
	constant,
	createFaceValueModel,
	type FaceValueModel,
	type FaceValueSolution,
	outputFactories,
	type CartesianGridPuzzleProps,
	type GridEdge,
	type GridFace,
	type GridVertex,
	type Solver,
	parseDoubledResolutionGrid,
} from '../lib/index.js';

export interface SpiralGalaxiesPuzzleProps extends CartesianGridPuzzleProps {
	pearls: SpiralGalaxyPearl[];
}

export type SpiralGalaxyPearl =
	| { type: 'face'; face: GridFace }
	| { type: 'edge'; edge: GridEdge }
	| { type: 'vertex'; vertex: GridVertex };

type SpiralGalaxiesModel = FaceValueModel<number>;
type SpiralGalaxiesSolution = FaceValueSolution<number>;

export class SpiralGalaxiesPuzzle extends CartesianGridPuzzle<SpiralGalaxiesSolution> {
	static {
		registerPuzzle({
			name: 'Spiral Galaxies',
			gridFormat: 'double-resolution',
			instructions: 'Use "o" for pearls.',
			example: `
·-·-·-·
|#|#|#|
·-o-·-·
|#|#|#|
·-·-·-·
|#|#|#|
·-·-·-·
`.trim(),
			parser: SpiralGalaxiesPuzzle,
		});
	}

	#pearls: SpiralGalaxyPearl[];

	constructor(props: SpiralGalaxiesPuzzleProps) {
		super(props, outputFactories.linedGrid);

		this.#pearls = props.pearls;

		for (const pearl of this.#pearls) {
			if (pearl.type === 'face') {
				this.output.faces.set(pearl.face, constant('o'));
			} else if (pearl.type === 'edge') {
				this.output.edges.set(pearl.edge, constant('o'));
			} else {
				this.output.vertices.set(pearl.vertex, constant('o'));
			}
		}
	}

	public static fromText(text: string) {
		const { width: faceWidth, height: faceHeight } =
			parseDoubledResolutionGrid(text, () => {});
		const pearls: SpiralGalaxyPearl[] = [];
		const context = new CartesianGridGraph({
			width: faceWidth + 1,
			height: faceHeight + 1,
		});
		parseDoubledResolutionGrid(text, ([_value], [x, y]) => {
			if (x % 2 === 1 && y % 2 === 1) {
				pearls.push({
					type: 'face',
					face: context.getFace([(x - 1) / 2, (y - 1) / 2]),
				});
			} else if (x % 2 === 1) {
				const left = context.getVertex([Math.floor(x / 2), y / 2]);
				pearls.push({
					type: 'edge',
					edge: context.getEdge(left, left.right),
				});
			} else if (y % 2 === 1) {
				const top = context.getVertex([x / 2, Math.floor(y / 2)]);
				pearls.push({
					type: 'edge',
					edge: context.getEdge(top, top.down),
				});
			} else {
				pearls.push({
					type: 'vertex',
					vertex: context.getVertex([x / 2, y / 2]),
				});
			}
		});

		return new SpiralGalaxiesPuzzle({
			width: faceWidth,
			height: faceHeight,
			pearls,
		});
	}

	public override build(
		context: ContextExtended<string>,
		solver: Solver<string>
	): SpiralGalaxiesModel {
		const facePearls = this.#pearls.filter(
			(pearl): pearl is Extract<SpiralGalaxyPearl, { type: 'face' }> =>
				pearl.type === 'face'
		);
		const values = facePearls.map((_, index) => index);
		const model = createFaceValueModel(context, solver, this, {
			values: values.length > 0 ? values : [0],
		});

		for (const [index, pearl] of facePearls.entries()) {
			solver.add(model.variables.forceGet(pearl.face).eq(index));
			this.output.faces.set(pearl.face, constant('o'));
		}
		for (const pearl of this.#pearls) {
			if (pearl.type === 'edge') {
				this.output.edges.set(pearl.edge, constant('o'));
			} else if (pearl.type === 'vertex') {
				this.output.vertices.set(pearl.vertex, constant('o'));
			}
		}

		// TODO: Enforce connected regions and reflection symmetry around each pearl.
		return model;
	}
}

import { registerPuzzle } from '../catalog.js';
import {
	CartesianGridPuzzle,
	ContextExtended,
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
	pearls: ConstructionSpiralGalaxyPearl[];
}

export interface ConstructionSpiralGalaxyPearl {
	type: 'face' | 'edge' | 'vertex';
	coord: [number, number];
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

		this.#pearls = props.pearls.map((pearl) => {
			if (pearl.type === 'face') {
				return {
					type: 'face',
					face: this.grid.getFace([
						(pearl.coord[0] - 1) / 2,
						(pearl.coord[1] - 1) / 2,
					]),
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
					};
				}
				const top = this.grid.getVertex([x / 2, Math.floor(y / 2)]);
				return {
					type: 'edge',
					edge: this.grid.getEdge(top, top.down),
				};
			}
			return {
				type: 'vertex',
				vertex: this.grid.getVertex([
					pearl.coord[0] / 2,
					pearl.coord[1] / 2,
				]),
			};
		});

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
			parseDoubledResolutionGrid(text, {});
		const pearls: ConstructionSpiralGalaxyPearl[] = [];
		parseDoubledResolutionGrid(text, {
			faces: ([value], [x, y]) => {
				if (value !== 'o') return;
				pearls.push({
					type: 'face',
					coord: [x, y],
				});
			},
			edges: ([value], [x, y]) => {
				if (value !== 'o') return;
				pearls.push({ type: 'edge', coord: [x, y] });
			},
			vertices: ([value], [x, y]) => {
				if (value !== 'o') return;
				pearls.push({
					type: 'vertex',
					coord: [x, y],
				});
			},
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

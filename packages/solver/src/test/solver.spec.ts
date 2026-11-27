import { afterAll, expect, it } from 'vitest';
import { shutdownSolverRuntime, SolverSession, z3 } from '../runtime/index.js';
import {
	CartesianGridGraph,
	constant,
	createValueDecoder,
	createEdgeValueModel,
	createGraphModel,
	createGraphOutput,
	createVertexValueModel,
	renderCartesianGrid,
	resolveGraphOutput,
	variable,
} from '../index.js';
import type {
	GridEdge,
	GridFace,
	GridVertex,
	PuzzleDefinition,
	VertexValueSolution,
} from '../index.js';

afterAll(async () => {
	await shutdownSolverRuntime();
});

it('aligns face columns independently and extends their horizontal edges', () => {
	const grid = new CartesianGridGraph({ vertexWidth: 3, vertexHeight: 3 });
	const display = {
		vertices: new Map<GridVertex, string>(),
		edges: new Map<GridEdge, string>(),
		faces: new Map<GridFace, string>(),
	};
	for (const edge of grid.edges()) {
		const [start, end] = edge.vertices;
		display.edges.set(edge, start.y === end.y ? '-' : '|');
	}
	display.faces.set(grid.getFace([0, 0]), '1');
	display.faces.set(grid.getFace([1, 0]), '123');
	display.faces.set(grid.getFace([0, 1]), '10');
	display.faces.set(grid.getFace([1, 1]), '2');
	const middle = grid.getVertex([1, 1]);
	display.edges.set(grid.getEdge(middle, middle.right), ' ');
	expect(renderCartesianGrid(grid, display)).toBe(
		'·--·---·\n|1 |123|\n·--·   ·\n|10|2  |\n·--·---·\n'
	);
});

it('aligns multi-digit vertex values with vertical edges', () => {
	const grid = new CartesianGridGraph({ vertexWidth: 2, vertexHeight: 2 });
	const display = {
		vertices: new Map<GridVertex, string>(),
		edges: new Map<GridEdge, string>(),
		faces: new Map<GridFace, string>(),
	};
	for (const edge of grid.edges()) {
		const [start, end] = edge.vertices;
		display.edges.set(edge, start.y === end.y ? '-' : '|');
	}
	display.vertices.set(grid.getVertex([0, 0]), '1');
	display.vertices.set(grid.getVertex([1, 0]), '22');
	display.vertices.set(grid.getVertex([0, 1]), '333');
	display.vertices.set(grid.getVertex([1, 1]), '4');
	display.faces.set(grid.getFace([0, 0]), '');
	expect(renderCartesianGrid(grid, display)).toBe('1  -22\n|   | \n333-4 \n');
});

it('keeps explicitly empty separator rows and columns collapsed', () => {
	const grid = new CartesianGridGraph({
		vertexWidth: 2,
		vertexHeight: 2,
	});
	const display = {
		vertices: new Map<GridVertex, string>(),
		edges: new Map<GridEdge, string>(),
		faces: new Map<GridFace, string>(),
	};
	for (const edge of grid.edges()) {
		display.edges.set(edge, '');
	}
	display.vertices.set(grid.getVertex([0, 0]), '10');
	display.vertices.set(grid.getVertex([1, 0]), '2');
	display.vertices.set(grid.getVertex([0, 1]), '3');
	display.vertices.set(grid.getVertex([1, 1]), '4');
	display.faces.set(grid.getFace([0, 0]), '');
	expect(renderCartesianGrid(grid, display)).toBe('102\n3 4\n');
});

it('loads the shared Z3 runtime and solves constraints', async () => {
	const { Solver, Int, Distinct } = new z3.Context('test');
	const solver = new Solver();
	const row = Array.from({ length: 4 }, (_, i) => Int.const(`cell_${i}`));

	for (const cell of row) {
		solver.add(cell.ge(1), cell.le(4));
	}
	solver.add(Distinct(...row), row[0].eq(1), row[1].eq(2), row[2].eq(3));

	expect(await solver.check()).toBe('sat');
	expect(solver.model().eval(row[3]).toString()).toBe('4');

	solver.push();
	solver.add(row[3].eq(3));
	expect(await solver.check()).toBe('unsat');
	solver.pop();
	expect(await solver.check()).toBe('sat');
}, 15000);

it('supports sparse integer edge domains with orientation-specific glyphs', async () => {
	const context = new z3.Context<string>('edge-values');
	const solver = new context.Solver();
	const grid = new CartesianGridGraph({
		vertexWidth: 2,
		vertexHeight: 2,
	});
	const vertex = grid.getVertex([0, 0]);
	const face = grid.getFace([0, 0]);
	const output = createGraphOutput();
	output.vertices.set(vertex, constant('V'));
	output.faces.set(face, constant('F'));
	const model = createEdgeValueModel(
		context,
		solver,
		{ grid, output },
		{
			values: [-2, 2] as const,
			glyphs: {
				horizontal: { [-2]: '-', 2: '=' },
				vertical: { [-2]: '|', 2: '#' },
			},
		}
	);
	const first = [...model.variables.values()][0];
	solver.push();
	solver.add(first.eq(0));
	expect(await solver.check()).toBe('unsat');
	solver.pop();
	for (const [edge, expression] of model.variables) {
		const [start, end] = edge.vertices;
		solver.add(expression.eq(start.y === end.y ? -2 : 2));
	}
	expect(await solver.check()).toBe('sat');
	const assignment = solver.model();
	const display = resolveGraphOutput(model.output, assignment);
	const solution = model.decodeSolution(assignment, display);
	for (const [edge, value] of solution) {
		const [start, end] = edge.vertices;
		expect(value).toBe(start.y === end.y ? -2 : 2);
	}
	expect(renderCartesianGrid(grid, display)).toBe('V-·\n#F#\n·-·\n');
	expect(model.keyAssignments).toEqual([...model.variables.values()]);
	expect(output.edges.size).toBe(0);
}, 15000);

it('validates finite value domains and rejects assignments outside them', () => {
	const context = new z3.Context<string>('value-decoding');
	const decode = createValueDecoder([-2, 2] as const);
	expect(decode(context.Int.val(-2))).toBe(-2);
	expect(decode(context.Int.val(2))).toBe(2);
	expect(() => decode(context.Int.val(0))).toThrow(
		'Invalid value assignment'
	);
	expect(() =>
		decode(context.Int.val(BigInt(Number.MAX_SAFE_INTEGER) + 1n))
	).toThrow('BigInt exceeds safe Number range');
	for (const assignment of [
		context.Bool.val(true),
		context.Real.val(2),
		context.Int.const('unresolved'),
	]) {
		expect(() => decode(assignment)).toThrow(
			'Expected an integer value assignment'
		);
	}
	for (const values of [[], [0.5], [Number.POSITIVE_INFINITY]]) {
		expect(() => createValueDecoder(values)).toThrow(
			'Values must be a non-empty domain of safe integers'
		);
	}
});

it('isolates puzzle contexts within the shared runtime', async () => {
	const first = new z3.Context('first');
	const second = new z3.Context('second');
	const firstSolver = new first.Solver();
	const secondSolver = new second.Solver();
	const firstCell = first.Int.const('cell');
	const secondCell = second.Int.const('cell');

	firstSolver.add(firstCell.eq(1));
	secondSolver.add(secondCell.eq(2));

	expect(await firstSolver.check()).toBe('sat');
	expect(firstSolver.model().eval(firstCell).toString()).toBe('1');
	expect(await secondSolver.check()).toBe('sat');
	expect(secondSolver.model().eval(secondCell).toString()).toBe('2');
}, 15000);

it('renders mixed graph bindings and enumerates only solution-defining assignments', async () => {
	const grid = new CartesianGridGraph({
		vertexWidth: 2,
		vertexHeight: 2,
	});
	const vertex = grid.getVertex([0, 0]);
	const top = grid.getEdge(vertex, vertex.right);
	const left = grid.getEdge(vertex, vertex.down);
	const face = grid.getFace([0, 0]);
	let builds = 0;
	const puzzle: PuzzleDefinition<number> = {
		build(context, solver) {
			builds++;
			const value = context.Int.const('value');
			const auxiliary = context.Int.const('auxiliary');
			solver.add(value.ge(0), value.le(1));
			solver.add(auxiliary.ge(0), auxiliary.le(2));
			const output = createGraphOutput();
			const decodeValue = createValueDecoder([0, 1] as const);
			const decodeCount = createValueDecoder([1, 2] as const);
			output.vertices.set(vertex, variable(value, decodeValue));
			output.vertices.set(
				vertex.right,
				constant('pearl', (name) => name[0].toUpperCase())
			);
			output.edges.set(top, constant('-'));
			output.edges.set(
				left,
				variable(
					value.eq(1),
					(assignment) => context.isTrue(assignment),
					(enabled) => (enabled ? '|' : ' ')
				)
			);
			output.faces.set(face, variable(value.add(1), decodeCount));
			return {
				output,
				keyAssignments: [value],
				decodeSolution: (model) => decodeValue(model.eval(value, true)),
			};
		},
	};
	const session = new SolverSession(puzzle);
	const first = await session.nextSolution();
	const second = await session.nextSolution();
	if (first.status !== 'sat' || second.status !== 'sat') {
		throw new Error('Expected two satisfiable solutions');
	}
	expect(new Set([first.solution, second.solution])).toEqual(new Set([0, 1]));
	for (const result of [first, second]) {
		expect(renderCartesianGrid(grid, result.output)).toBe(
			`${result.solution}-P\n${result.solution === 1 ? '|' : ' '}${
				result.solution + 1
			} \n· ·\n`
		);
	}
	expect(await session.nextSolution()).toEqual({ status: 'unsat' });
	expect(builds).toBe(1);
}, 15000);

it('supports display-only models and treats empty keys as one solution', async () => {
	const grid = new CartesianGridGraph({
		vertexWidth: 2,
		vertexHeight: 2,
	});
	const face = grid.getFace([0, 0]);
	const session = new SolverSession({
		build(context, solver) {
			const value = context.Int.const('value');
			solver.add(value.eq(7));
			const output = createGraphOutput();
			output.faces.set(face, constant(7, String));
			output.vertices.set(grid.getVertex([0, 0]), variable(value));
			return createGraphModel(output, []);
		},
	});
	const result = await session.nextSolution();
	if (result.status !== 'sat') {
		throw new Error('Expected a satisfiable solution');
	}
	expect(result.solution).toBe(result.output);
	expect(result.output.faces.get(face)).toBe('7');
	expect(result.output.vertices.get(grid.getVertex([0, 0]))).toBe('7');
	expect(await session.nextSolution()).toEqual({ status: 'unsat' });
}, 15000);

it('renders and enumerates vertex values while preserving other output bindings', async () => {
	const grid = new CartesianGridGraph({
		vertexWidth: 2,
		vertexHeight: 2,
	});
	const vertex = grid.getVertex([0, 0]);
	const output = createGraphOutput();
	output.edges.set(grid.getEdge(vertex, vertex.right), constant('-'));
	output.faces.set(grid.getFace([0, 0]), constant('F'));
	const puzzle: PuzzleDefinition<VertexValueSolution<1 | 2>> = {
		build(context, solver) {
			const model = createVertexValueModel(
				context,
				solver,
				{ grid, output },
				{
					values: [1, 2] as const,
					glyphs: { 1: 'A', 2: 'B' },
				}
			);
			// A coordinate-named auxiliary must not collide with vertex variables.
			solver.add(context.Int.const(vertex.toString()).eq(9));
			for (const [key, expression] of model.variables) {
				if (key !== vertex) {
					solver.add(expression.eq(1));
				}
			}
			expect(model.keyAssignments).toEqual([...model.variables.values()]);
			return model;
		},
	};
	const session = new SolverSession(puzzle);
	const first = await session.nextSolution();
	const second = await session.nextSolution();
	if (first.status !== 'sat' || second.status !== 'sat') {
		throw new Error('Expected two satisfiable vertex solutions');
	}
	expect(
		new Set([first.solution.get(vertex), second.solution.get(vertex)])
	).toEqual(new Set([1, 2]));
	for (const result of [first, second]) {
		expect(result.solution.size).toBe(4);
		expect(renderCartesianGrid(grid, result.output)).toBe(
			`${result.solution.get(vertex) === 1 ? 'A' : 'B'}-A\n F \nA A\n`
		);
	}
	expect(await session.nextSolution()).toEqual({ status: 'unsat' });
	expect(output.vertices.size).toBe(0);
}, 15000);

it.each(['edges', 'vertices'] as const)(
	'formats decoded %s as numbers when glyphs are omitted',
	async (kind) => {
		const context = new z3.Context<string>('numeric-output');
		const solver = new context.Solver();
		const grid = new CartesianGridGraph({
			vertexWidth: 2,
			vertexHeight: 1,
		});
		const options = { values: [-2, 2] as const };
		const model =
			kind === 'edges'
				? createEdgeValueModel(context, solver, { grid }, options)
				: createVertexValueModel(context, solver, { grid }, options);
		for (const expression of model.variables.values()) {
			solver.add(expression.eq(-2));
		}
		expect(await solver.check()).toBe('sat');
		const assignment = solver.model();
		const display = resolveGraphOutput(model.output, assignment);
		const rendered = [
			...display.edges.values(),
			...display.vertices.values(),
		];
		expect(rendered.length).toBe(model.variables.size);
		expect(new Set(rendered)).toEqual(new Set(['-2']));
		const solution = model.decodeSolution(assignment, display);
		expect(new Set(solution.values())).toEqual(new Set([-2]));
	},
	15000
);

it('rejects incomplete explicit glyph maps instead of using numeric fallback', () => {
	const context = new z3.Context<string>('incomplete-glyphs');
	const solver = new context.Solver();
	const grid = new CartesianGridGraph({
		vertexWidth: 1,
		vertexHeight: 1,
	});
	const values: number[] = [0, 1];
	expect(() =>
		createVertexValueModel(
			context,
			solver,
			{ grid },
			{
				values,
				glyphs: { 0: '0' },
			}
		)
	).toThrow('Missing value glyph for value 1');
});

import { afterAll, expect, it } from 'vitest';
import { killThreads, z3 } from '../z3.js';
import {
	CartesianGridGraph,
	constant,
	createEdgeValueDecoder,
	createEdgeValueModel,
	createGraphModel,
	createGraphOutput,
	renderCartesianGrid,
	resolveGraphOutput,
	SolverSession,
	variable,
} from '../index.js';
import type { PuzzleDefinition } from '../puzzle.js';

afterAll(async () => {
	await killThreads(z3.em);
});

it('loads Z3 and solves puzzle constraints through the package entry point', async () => {
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
	const grid = new CartesianGridGraph({ width: 2, height: 2 });
	const vertex = grid.getVertex([0, 0]);
	const face = grid.getFace([0, 0]);
	const output = createGraphOutput();
	output.vertices.set(vertex, constant('V'));
	output.faces.set(face, constant('F'));
	const model = createEdgeValueModel(context, solver, { grid, output }, {
		values: [-2, 2] as const,
		glyphs: {
			horizontal: { [-2]: '-', 2: '=' },
			vertical: { [-2]: '|', 2: '#' },
		},
	});
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

it('validates finite edge domains and rejects assignments outside them', () => {
	const context = new z3.Context<string>('edge-decoding');
	const decode = createEdgeValueDecoder([-2, 2] as const);
	expect(decode(context.Int.val(-2))).toBe(-2);
	expect(decode(context.Int.val(2))).toBe(2);
	expect(() => decode(context.Int.val(0))).toThrow('Invalid edge assignment');
	expect(() =>
		decode(context.Int.val(BigInt(Number.MAX_SAFE_INTEGER) + 1n))
	).toThrow('Invalid edge assignment');
	for (const assignment of [
		context.Bool.val(true),
		context.Real.val(2),
		context.Int.const('unresolved'),
	]) {
		expect(() => decode(assignment)).toThrow(
			'Expected an integer edge assignment'
		);
	}
	for (const values of [[], [0.5], [Number.POSITIVE_INFINITY]]) {
		expect(() => createEdgeValueDecoder(values)).toThrow(
			'Edge values must be a non-empty domain of safe integers'
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
	const grid = new CartesianGridGraph({ width: 2, height: 2 });
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
			const decodeValue = createEdgeValueDecoder([0, 1] as const);
			const decodeCount = createEdgeValueDecoder([1, 2] as const);
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
	const grid = new CartesianGridGraph({ width: 2, height: 2 });
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

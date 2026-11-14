import { afterAll, expect, it } from 'vitest';
import { killThreads, z3 } from '../index.js';

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

# Solver

`@belle-puzzles/solver` is the starting point for logic puzzle solving in Belle
Puzzles. It exports a shared, initialized `z3` runtime and re-exports the upstream
[`z3-solver`](https://github.com/Z3Prover/z3/tree/master/src/api/js) API and types,
without introducing a separate modeling API or puzzle-specific solvers.

## Development

From the repository root:

```sh
pnpm --filter @belle-puzzles/solver build
pnpm --filter @belle-puzzles/solver test
```

The root build and test commands also include this package automatically.
Other workspace packages can depend on it using `"@belle-puzzles/solver": "workspace:0.0.1"`.

## Usage

The module initializes Z3 once using top-level await. Importers receive a ready
runtime without calling `init()` themselves; initialization failures reject the
import. This requires an ESM environment with top-level await support.

For example, this Node.js program finds two distinct digits with a sum of three:

```ts
import { killThreads, z3 } from '@belle-puzzles/solver';

try {
	const { Solver, Int, Distinct } = new z3.Context('puzzle');
	const solver = new Solver();
	const x = Int.const('x');
	const y = Int.const('y');

	solver.add(
		x.ge(1),
		x.le(9),
		y.ge(1),
		y.le(9),
		Distinct(x, y),
		x.add(y).eq(3)
	);

	const result = await solver.check();
	if (result === 'sat') {
		const model = solver.model();
		console.log(model.eval(x).toString(), model.eval(y).toString());
	} else {
		console.log(result);
	}
} finally {
	await killThreads(z3.em);
}
```

Keep the shared runtime alive while any consumer is using it; only the application
or test-suite owner should call `killThreads(z3.em)` when finished so Node.js can
exit, not individual puzzle solvers. Solver results can be `sat`, `unsat`, or
`unknown`; do not treat `unknown` as proof that a puzzle has no solution.

Create separate contexts for independent puzzle models; they can share the same
runtime. Long-running operations are serialized within a runtime. Separate
runtimes are useful for parallel solves, different initialization options, or
independent worker lifetimes, at the cost of additional initialization and memory.
The upstream `init()` remains available for those cases.

## Browser integration

The website does not load this package yet. A dynamic `import()` can defer loading
and initialization until a solver is needed. Z3 includes a browser runtime, but
integrating it requires serving its WASM and worker assets and enabling
cross-origin isolation (`Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp`). Those headers must be checked
against the site's authentication and cross-origin resources before enabling them.
See the upstream documentation for bundler and runtime requirements.

# Solver

`@belle-puzzles/solver` is the starting point for logic puzzle solving in Belle
Puzzles. It provides graph-based puzzle models, solver sessions, parsers, rendering
helpers, and puzzle-specific solvers built on the upstream
[`z3-solver`](https://github.com/Z3Prover/z3/tree/master/src/api/js) library.

## Development

From the repository root:

```sh
pnpm --filter @belle-puzzles/solver build
pnpm --filter @belle-puzzles/solver test
```

The root build and test commands also include this package automatically.
Other workspace packages can depend on it using `"@belle-puzzles/solver": "workspace:0.0.1"`.

## Usage

Puzzle helpers initialize a shared Z3 runtime internally using top-level await,
so callers do not need to call `init()` themselves. Initialization failures reject
the import. This requires an ESM environment with top-level await support.

For direct Z3 modeling with your own runtime, use the upstream API. For example,
this Node.js program finds two distinct digits with a sum of three:

```ts
import { init, killThreads } from 'z3-solver';

const z3 = await init();

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

Keep the runtime alive while any consumer is using it; only the application
or test-suite owner should call `killThreads(z3.em)` when finished so Node.js can
exit, not individual puzzle solvers. Solver results can be `sat`, `unsat`, or
`unknown`; do not treat `unknown` as proof that a puzzle has no solution.

Create separate contexts for independent puzzle models; they can share the same
runtime. Long-running operations are serialized within a runtime. Separate
runtimes are useful for parallel solves, different initialization options, or
independent worker lifetimes, at the cost of additional initialization and memory.
The upstream `init()` remains available for those cases.

## Browser integration

The website's `/solvers/:puzzleType` pages load this package on demand in a
dedicated worker. They are public, lazy-loaded routes in the site's SPA, outside
authentication loaders and login gates. Cross-origin isolation headers
(`Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp`) apply to the whole site, including
HTML and worker responses. This permits client-side navigation into solver
pages without a document reload. The site README describes compatibility
requirements for authentication and cross-origin resources.

Z3's `z3-built.js` and `z3-built.wasm` are served unbundled from `/solver-assets/`.
A classic worker loads the script before dynamically importing the bundled solver
module. Its Emscripten `mainScriptUrlOrBlob` points to the original script so
pthread workers can load it independently.

The worker owns the runtime. On cancellation, replacement, navigation, or
exhaustion, it calls `shutdownSolverRuntime()` (the upstream `killThreads` helper)
before acknowledging disposal. Only then does the page terminate the parent
worker, releasing its context, expression references, and WASM memory. Never
terminate only the parent worker while leaving Z3's pthread workers running.
Initialization failures also explicitly terminate any spawned threads.

After showing the first solution, the UI requests exactly one additional solution
to check uniqueness. It caches that second solution until requested; later
solutions are computed only on demand. An `unknown` result or a cancelled probe
does not establish uniqueness.

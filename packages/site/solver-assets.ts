// Node-side Vite plugin used by vite.config.ts. It serves Z3's
// JS/WASM at /solver-assets/ in development and emits them into production builds.
// Keep these assets unbundled so Emscripten can load its worker script correctly.
// Isolation headers are shared with Vite's dev/preview configuration and applied
// directly to development asset responses; deployment headers live in staticwebapp.config.json.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePath, type Plugin } from 'vite';

export const isolationHeaders = {
	'Cross-Origin-Opener-Policy': 'same-origin',
	'Cross-Origin-Embedder-Policy': 'require-corp',
};

export function solverAssets(): Plugin {
	const solverEntry = import.meta.resolve('@belle-puzzles/solver');
	const solverRequire = createRequire(solverEntry);
	const solverDirectory = normalizePath(dirname(fileURLToPath(solverEntry)));
	const z3Directory = dirname(solverRequire.resolve('z3-solver'));
	const assets = ['z3-built.js', 'z3-built.wasm'];
	let building = false;
	return {
		name: 'solver-assets',
		configResolved(config) {
			building = config.command === 'build';
		},
		// This ensures the puzzle catalog (which uses module load side effects) is up-to-date.
		handleHotUpdate({ file, server }) {
			if (
				normalizePath(file).startsWith(`${solverDirectory}/`) &&
				file.endsWith('.js')
			) {
				server.ws.send({ type: 'full-reload' });
				return [];
			}
		},
		buildStart() {
			if (!building) return;
			for (const name of assets) {
				this.emitFile({
					type: 'asset',
					fileName: `solver-assets/${name}`,
					source: readFileSync(resolve(z3Directory, name)),
				});
			}
		},
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				const path = req.url?.split('?')[0];
				const asset = assets.find(
					(name) => path === `/solver-assets/${name}`
				);
				if (!asset) {
					next();
					return;
				}
				for (const [name, value] of Object.entries(isolationHeaders)) {
					res.setHeader(name, value);
				}
				res.setHeader(
					'Content-Type',
					asset.endsWith('.wasm')
						? 'application/wasm'
						: 'text/javascript'
				);
				res.end(readFileSync(resolve(z3Directory, asset)));
			});
		},
	};
}

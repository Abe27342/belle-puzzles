// Node-side Vite plugin used by vite.config.ts. It serves Z3's
// JS/WASM at content-addressed /solver-assets/z3/ URLs and emits them into builds.
// Keep these assets unbundled so Emscripten can load its worker script correctly.
// The classic bootstrap also bypasses Vite's development module transforms.
// Isolation headers are shared with Vite's dev/preview configuration and applied
// directly to development asset responses; deployment headers live in staticwebapp.config.json.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePath, type Plugin } from 'vite';

export const isolationHeaders = {
	'Cross-Origin-Opener-Policy': 'same-origin',
	'Cross-Origin-Embedder-Policy': 'require-corp',
};

export const z3AssetCacheControl = 'public, max-age=31536000, immutable';

export function getZ3AssetBase(
	assets: readonly { name: string; source: Uint8Array }[]
): string {
	const fingerprints = assets
		.map(
			({ name, source }) =>
				`${name}:${createHash('sha256').update(source).digest('hex')}`
		)
		.sort();
	const hash = createHash('sha256')
		.update(fingerprints.join('\n'))
		.digest('hex');
	return `/solver-assets/z3/${hash}/`;
}

export function solverAssets(): Plugin {
	const solverEntry = import.meta.resolve('@belle-puzzles/solver');
	const solverRequire = createRequire(solverEntry);
	const solverDirectory = normalizePath(dirname(fileURLToPath(solverEntry)));
	const z3Directory = dirname(solverRequire.resolve('z3-solver'));
	const bootstrapFile = fileURLToPath(
		new URL('./src/solvers/bootstrap.js', import.meta.url)
	);
	const assets = ['z3-built.js', 'z3-built.wasm'].map((name) => ({
		name,
		source: readFileSync(resolve(z3Directory, name)),
	}));
	const assetBase = getZ3AssetBase(assets);
	let building = false;
	return {
		name: 'solver-assets',
		config() {
			return {
				define: {
					'import.meta.env.VITE_Z3_ASSET_BASE':
						JSON.stringify(assetBase),
				},
			};
		},
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
			for (const { name, source } of assets) {
				this.emitFile({
					type: 'asset',
					fileName: `${assetBase.slice(1)}${name}`,
					source,
				});
			}
		},
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				const path = req.url?.split('?')[0];
				const isBootstrap =
					path === '/src/solvers/bootstrap.js' &&
					!/[?&]url(?:[=&]|$)/.test(req.url ?? '');
				const asset = isBootstrap
					? {
							name: 'bootstrap.js',
							source: readFileSync(bootstrapFile),
					  }
					: assets.find(({ name }) => path === `${assetBase}${name}`);
				if (!asset) {
					next();
					return;
				}
				for (const [name, value] of Object.entries(isolationHeaders)) {
					res.setHeader(name, value);
				}
				res.setHeader(
					'Cache-Control',
					isBootstrap ? 'no-cache' : z3AssetCacheControl
				);
				res.setHeader(
					'Content-Type',
					asset.name.endsWith('.wasm')
						? 'application/wasm'
						: 'text/javascript'
				);
				res.end(asset.source);
			});
		},
	};
}

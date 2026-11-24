// @vitest-environment node
import { request, type IncomingHttpHeaders } from 'node:http';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, createServer } from 'vite';
import { expect, it, vi } from 'vitest';
import {
	getZ3AssetBase,
	isolationHeaders,
	solverAssets,
	z3AssetCacheControl,
} from '../solver-assets';

function readAsset(port: number, path: string, method = 'GET') {
	return new Promise<{ headers: IncomingHttpHeaders; body: string }>(
		(resolve, reject) => {
			const req = request(
				{
					host: '127.0.0.1',
					port,
					path,
					method,
					headers: { 'sec-fetch-dest': 'worker' },
				},
				(res) => {
					if (res.statusCode !== 200) {
						reject(
							new Error(
								`Asset ${path} returned ${res.statusCode}`
							)
						);
						res.resume();
						return;
					}
					let body = '';
					res.setEncoding('utf8');
					res.on('data', (chunk: string) => {
						body += chunk;
					});
					res.on('end', () =>
						resolve({ headers: res.headers, body })
					);
					res.on('error', reject);
				}
			);
			req.on('error', reject);
			req.end();
		}
	);
}

it('keeps asset URLs stable and changes the shared hash when either Z3 file changes', () => {
	const assets = [
		{ name: 'z3-built.js', source: Buffer.from('loader') },
		{ name: 'z3-built.wasm', source: Buffer.from('wasm') },
	];
	const base = getZ3AssetBase(assets);
	expect(base).toMatch(/^\/solver-assets\/z3\/[a-f0-9]{64}\/$/);
	expect(getZ3AssetBase([...assets].reverse())).toBe(base);
	for (const changed of assets) {
		expect(
			getZ3AssetBase(
				assets.map((asset) =>
					asset === changed
						? { ...asset, source: Buffer.from('updated') }
						: asset
				)
			)
		).not.toBe(base);
	}
});

it('serves isolated Z3 assets and resets registration on solver rebuilds', async () => {
	const server = await createServer({
		configFile: false,
		root: fileURLToPath(new URL('..', import.meta.url)),
		plugins: [solverAssets()],
		optimizeDeps: { noDiscovery: true, include: [] },
		server: { host: '127.0.0.1', port: 0, headers: isolationHeaders },
	});
	try {
		await server.listen();
		const address = server.httpServer?.address();
		if (!address || typeof address === 'string')
			throw new Error('Vite did not start a TCP listener');
		const serializedBase =
			server.config.define?.['import.meta.env.VITE_Z3_ASSET_BASE'];
		if (typeof serializedBase !== 'string')
			throw new Error('Vite did not define the Z3 asset base');
		const assetBase: unknown = JSON.parse(serializedBase);
		if (typeof assetBase !== 'string')
			throw new Error('Z3 asset base is not a URL string');
		for (const [asset, mimeType] of [
			['z3-built.js', 'text/javascript'],
			['z3-built.wasm', 'application/wasm'],
		]) {
			const { headers } = await readAsset(
				address.port,
				`${assetBase}${asset}`,
				'HEAD'
			);
			expect(headers['cross-origin-opener-policy']).toBe(
				isolationHeaders['Cross-Origin-Opener-Policy']
			);
			expect(headers['cross-origin-embedder-policy']).toBe(
				isolationHeaders['Cross-Origin-Embedder-Policy']
			);
			expect(headers['content-type']).toBe(mimeType);
			expect(headers['cache-control']).toBe(z3AssetCacheControl);
		}
		const bootstrapModule = await server.transformRequest(
			'/src/solvers/bootstrap.js?url&no-inline'
		);
		const urlMatch = bootstrapModule?.code.match(
			/export default ("[^"]+")/
		);
		if (!urlMatch) throw new Error('Missing development bootstrap URL');
		const bootstrapUrl: unknown = JSON.parse(urlMatch[1]);
		if (typeof bootstrapUrl !== 'string')
			throw new Error('Development bootstrap URL is not a string');
		const { headers: bootstrapHeaders, body: bootstrapSource } =
			await readAsset(address.port, bootstrapUrl);
		expect(bootstrapHeaders['cache-control']).toBe('no-cache');
		expect(bootstrapSource).not.toMatch(/^\s*import\s/m);
		expect(bootstrapSource).toBe(
			readFileSync(
				new URL('../src/solvers/bootstrap.js', import.meta.url),
				'utf8'
			)
		);
		const send = vi.spyOn(server.ws, 'send');
		server.watcher.emit(
			'change',
			fileURLToPath(
				new URL('../../solver/dist/puzzles/masyu.js', import.meta.url)
			)
		);
		await vi.waitFor(() => {
			expect(send).toHaveBeenCalledWith({ type: 'full-reload' });
		});
	} finally {
		await server.close();
	}
}, 10000);

it('emits the matching versioned Z3 pair and a separate hashed classic bootstrap', async () => {
	const result = await build({
		configFile: false,
		root: fileURLToPath(new URL('..', import.meta.url)),
		publicDir: false,
		logLevel: 'silent',
		plugins: [solverAssets()],
		worker: { format: 'es' },
		build: {
			write: false,
			minify: false,
			reportCompressedSize: false,
			rollupOptions: {
				input: fileURLToPath(
					new URL('../src/solvers/client.ts', import.meta.url)
				),
				preserveEntrySignatures: 'strict',
			},
		},
	});
	if (Array.isArray(result) || !('output' in result))
		throw new Error('Expected one non-watch Vite build output');
	const assets = result.output.filter((entry) => entry.type === 'asset');
	const z3Assets = assets.filter((asset) =>
		asset.fileName.startsWith('solver-assets/z3/')
	);
	expect(z3Assets).toHaveLength(2);
	const assetBase = getZ3AssetBase(
		z3Assets.map((asset) => ({
			name: basename(asset.fileName),
			source:
				typeof asset.source === 'string'
					? Buffer.from(asset.source)
					: asset.source,
		}))
	);
	expect(z3Assets.map((asset) => asset.fileName).sort()).toEqual([
		`${assetBase.slice(1)}z3-built.js`,
		`${assetBase.slice(1)}z3-built.wasm`,
	]);
	expect(
		result.output.some(
			(entry) => entry.type === 'chunk' && entry.code.includes(assetBase)
		)
	).toBe(true);
	const bootstrap = assets.find((asset) =>
		/^assets\/bootstrap-[\w-]+\.js$/.test(asset.fileName)
	);
	if (!bootstrap) throw new Error('Missing hashed bootstrap asset');
	expect(
		typeof bootstrap.source === 'string'
			? bootstrap.source
			: new TextDecoder().decode(bootstrap.source)
	).toBe(
		readFileSync(
			new URL('../src/solvers/bootstrap.js', import.meta.url),
			'utf8'
		)
	);
}, 10000);

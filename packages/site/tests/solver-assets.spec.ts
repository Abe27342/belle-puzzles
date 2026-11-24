// @vitest-environment node
import { request, type IncomingHttpHeaders } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { expect, it, vi } from 'vitest';
import { isolationHeaders, solverAssets } from '../solver-assets';

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
		for (const [asset, mimeType] of [
			['z3-built.js', 'text/javascript'],
			['z3-built.wasm', 'application/wasm'],
		]) {
			const headers = await new Promise<IncomingHttpHeaders>(
				(resolve, reject) => {
					const req = request(
						{
							host: '127.0.0.1',
							port: address.port,
							path: `/solver-assets/${asset}`,
							method: 'HEAD',
						},
						(res) => {
							res.resume();
							if (res.statusCode !== 200)
								reject(
									new Error(
										`Asset ${asset} returned ${res.statusCode}`
									)
								);
							else resolve(res.headers);
						}
					);
					req.on('error', reject);
					req.end();
				}
			);
			expect(headers['cross-origin-opener-policy']).toBe(
				isolationHeaders['Cross-Origin-Opener-Policy']
			);
			expect(headers['cross-origin-embedder-policy']).toBe(
				isolationHeaders['Cross-Origin-Embedder-Policy']
			);
			expect(headers['content-type']).toBe(mimeType);
		}
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

import { spawn } from 'node:child_process';
import { mkdtemp, open, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import type { TestProject } from 'vitest/node';
import { availablePort } from './utils';

declare module 'vitest' {
	export interface ProvidedContext {
		fluidEndpoint: string;
	}
}

export default async function setup(project: TestProject) {
	const externalEndpoint = process.env.PUZZLEHUNT_FLUID_ENDPOINT;
	if (externalEndpoint) {
		project.provide('fluidEndpoint', externalEndpoint);
		return;
	}

	const require = createRequire(import.meta.url);
	const executable = require.resolve('@fluidframework/azure-local-service');

	const port = await availablePort('Tinylicious');

	const directory = await mkdtemp(join(tmpdir(), 'belle-puzzles-fluid-'));
	const logPath = join(directory, 'service.log');
	const log = await open(logPath, 'w');
	const endpoint = `http://127.0.0.1:${port}`;
	const service = spawn(
		process.execPath,
		[executable, '--storage', join(directory, 'storage')],
		{
			env: { ...process.env, PORT: String(port) },
			stdio: ['ignore', log.fd, log.fd],
		}
	);
	let spawnError: Error | undefined;
	service.on('error', (error) => {
		spawnError = error;
	});
	const serviceExit = new Promise<void>((resolve) => {
		service.once('exit', () => resolve());
		service.once('error', () => resolve());
	});
	const stop = async () => {
		if (
			!spawnError &&
			service.exitCode === null &&
			service.signalCode === null
		) {
			service.kill();
		}
		await serviceExit;
		await log.close();
		await rm(directory, { recursive: true, force: true });
	};

	try {
		const deadline = Date.now() + 30000;
		let readinessError: unknown;
		while (Date.now() < deadline) {
			if (
				spawnError ||
				service.exitCode !== null ||
				service.signalCode !== null
			) {
				throw (
					spawnError ??
					new Error('Local ordering service exited during startup.')
				);
			}
			let ready = false;
			try {
				const response = await fetch(endpoint, {
					signal: AbortSignal.timeout(1000),
				});
				await response.body?.cancel();
				ready = response.status < 500;
				if (!ready) {
					readinessError = new Error(
						`Ordering service returned HTTP ${response.status}.`
					);
				}
			} catch (error) {
				readinessError = error;
			}
			if (ready) {
				project.provide('fluidEndpoint', endpoint);
				return stop;
			}
			await setTimeout(100);
		}
		throw new Error('Local ordering service did not become responsive.', {
			cause: readinessError,
		});
	} catch (error) {
		try {
			console.error((await readFile(logPath, 'utf8')).slice(-5000));
		} finally {
			await stop();
		}
		throw error;
	}
}

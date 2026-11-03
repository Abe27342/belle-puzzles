import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const reservation = createServer();
await new Promise((resolve, reject) => {
	reservation.once('error', reject);
	reservation.listen(0, '127.0.0.1', resolve);
});
const address = reservation.address();
if (!address || typeof address === 'string') {
	throw new Error('Could not allocate a local ordering-service test port.');
}
await new Promise((resolve, reject) =>
	reservation.close((error) => (error ? reject(error) : resolve()))
);

const directory = await mkdtemp(join(tmpdir(), 'belle-puzzles-fluid-'));
const logPath = join(directory, 'service.log');
const log = createWriteStream(logPath);
const endpoint = `http://127.0.0.1:${address.port}`;
const service = spawn(
	process.execPath,
	[
		require.resolve('@fluidframework/azure-local-service'),
		'--storage',
		join(directory, 'storage'),
	],
	{
		env: { ...process.env, PORT: String(address.port) },
		stdio: ['ignore', 'pipe', 'pipe'],
	}
);
service.stdout.pipe(log, { end: false });
service.stderr.pipe(log, { end: false });
let spawnError;
service.on('error', (error) => {
	spawnError = error;
});
const serviceExit = new Promise((resolve) => {
	service.once('exit', resolve);
	service.once('error', resolve);
});
let tests;
const interrupt = () => {
	tests?.kill();
	service.kill();
};
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);

try {
	let ready = false;
	let readinessError;
	for (let attempt = 0; attempt < 300; attempt++) {
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
		try {
			const response = await fetch(endpoint, {
				signal: AbortSignal.timeout(1000),
			});
			if (response.status < 500) {
				ready = true;
				break;
			}
		} catch (error) {
			readinessError = error;
		}
		await setTimeout(100);
	}
	if (!ready) {
		throw new Error('Local ordering service did not become responsive.', {
			cause: readinessError,
		});
	}
	tests = spawn(
		process.execPath,
		[
			join(
				dirname(require.resolve('vitest/package.json')),
				require('vitest/package.json').bin.vitest
			),
			'run',
			...process.argv.slice(2),
		],
		{
			env: { ...process.env, PUZZLEHUNT_FLUID_ENDPOINT: endpoint },
			stdio: 'inherit',
		}
	);
	const [code] = await once(tests, 'exit');
	process.exitCode = code ?? 1;
	if (process.exitCode !== 0) {
		console.error((await readFile(logPath, 'utf8')).slice(-5000));
	}
} catch (error) {
	console.error((await readFile(logPath, 'utf8')).slice(-5000));
	throw error;
} finally {
	if (service.exitCode === null && service.signalCode === null) {
		service.kill();
	}
	await serviceExit;
	await new Promise((resolve) => log.end(resolve));
	process.off('SIGINT', interrupt);
	process.off('SIGTERM', interrupt);
	await rm(directory, { recursive: true, force: true });
}

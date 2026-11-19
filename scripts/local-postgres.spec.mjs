import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
	assertPortFree,
	databaseReady,
	portOpen,
	readConfiguration,
	startDatabase,
	startProcess,
	stopProcess,
	waitFor,
} from './local-postgres.mjs';

const root = resolve('.');
const require = createRequire(
	join(root, 'packages', 'puzzlehunt-model', 'package.json')
);
const siteRequire = createRequire(
	join(root, 'packages', 'site', 'package.json')
);
const { Client } = require('pg');
const { default: EmbeddedPostgres } = await import(
	pathToFileURL(require.resolve('embedded-postgres'))
);
const { default: binaries } = await import(
	pathToFileURL(
		join(dirname(require.resolve('embedded-postgres')), 'binary.js')
	)
);
const signals = pathToFileURL(
	join(root, 'scripts', 'local-stack-signals.mjs')
).href;
let directory;
let cluster;
let env;
let records = [];
let cleanups = [];
async function availablePort() {
	const server = createServer();
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	const port = server.address().port;
	await new Promise((resolve) => server.close(resolve));
	return port;
}
async function query(sql) {
	const client = new Client({ connectionString: env.DATABASE_URL });
	await client.connect();
	try {
		return await client.query(sql);
	} finally {
		await client.end();
	}
}
beforeAll(async () => {
	directory = await mkdtemp(join(tmpdir(), 'belle-launch-test-'));
	const data = join(directory, 'data');
	const port = await availablePort();
	const password = crypto.randomUUID();
	cluster = new EmbeddedPostgres({
		databaseDir: data,
		port,
		user: 'postgres',
		password,
		persistent: true,
		postgresFlags: ['-h', '127.0.0.1'],
		autoRehydrateSymlinks: true,
		onLog: () => {},
	});
	env = {
		DATABASE_URL: `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`,
		LOCAL_POSTGRES_DATA_DIR: data,
		LOCAL_POSTGRES_BIN: dirname((await binaries()).postgres),
	};
	// Initialization belongs to this disposable fixture, never to the launcher.
	await cluster.initialise();
	await cluster.start();
	await query(
		await readFile(
			require.resolve(
				'@belle-puzzles/puzzlehunt-model/postgres/schema.sql'
			),
			'utf8'
		)
	);
	await query(
		"INSERT INTO hunts (id, guild_id, name, schema_version, revision) VALUES ('11111111-1111-4111-8111-111111111111', '123', 'Persistent fixture', 1, 0)"
	);
}, 60000);
afterEach(async () => {
	for (const record of records.reverse())
		if (record.name !== 'PostgreSQL') await stopProcess(record, 3000);
	for (const cleanup of cleanups.reverse()) await cleanup();
	records = [];
	cleanups = [];
}, 30000);
afterAll(async () => {
	await cluster?.stop();
	if (directory) await rm(directory, { recursive: true, force: true });
}, 30000);

it('reuses a running database without owning it, and rejects a different configured directory', async () => {
	const stop = await startDatabase(env, records);
	expect(records).toHaveLength(0);
	await stop();
	expect(await databaseReady(env.DATABASE_URL)).toBe(true);
	await expect(
		startDatabase({ ...env, LOCAL_POSTGRES_DATA_DIR: directory }, records)
	).rejects.toThrow('does not match');
	expect((await query('SELECT name FROM hunts')).rows[0].name).toBe(
		'Persistent fixture'
	);
});

it('rejects missing opt-in, inconsistent local identities/tokens and browser secrets before launch', async () => {
	const workspace = join(directory, 'configuration');
	const site = join(workspace, 'packages', 'site');
	const api = join(workspace, 'packages', 'site-api');
	await mkdir(site, { recursive: true });
	await mkdir(api, { recursive: true });
	const localSettings = {
		IsEncrypted: false,
		Values: {
			FUNCTIONS_WORKER_RUNTIME: 'node',
			DISCORD_TOKEN: 'test-token',
		},
	};
	await writeFile(
		join(api, 'local.settings.json'),
		JSON.stringify(localSettings)
	);
	await writeFile(
		join(site, '.env.local-postgres.local'),
		'VITE_BELLE_BOT_CLIENT_ID=123\n'
	);
	await writeFile(
		join(site, '.env.local-postgres'),
		'VITE_BELLE_BOT_BASE_URL=http://localhost:3000\nVITE_PUZZLEHUNT_SERVICE_BASE_URL=http://localhost:3001\n'
	);
	await writeFile(
		join(workspace, '.env'),
		[
			'LOCAL_POSTGRES_STACK=1',
			'LOCAL_POSTGRES_GUILD_IDS=456',
			'GUILD_ALLOW_LIST=456',
			'CLIENT_ID=123',
			'VITE_BELLE_BOT_CLIENT_ID=123',
			'DISCORD_TOKEN=test-token',
			`DATABASE_URL=${env.DATABASE_URL}`,
			'PUZZLEHUNT_SERVICE_BASE_URL=http://127.0.0.1:3001',
			`PUZZLEHUNT_SERVICE_TOKEN=${'x'.repeat(32)}`,
			'PUZZLEHUNT_ALLOWED_ORIGINS=http://localhost:9000',
			`LOCAL_FUNCTIONS_PATH='${process.execPath}'`,
			`GOOGLE_API_KEY='{"client_email":"fixture","private_key":"fixture"}'`,
		].join('\n')
	);
	expect((await readConfiguration({}, workspace)).config.guildIds).toEqual([
		'456',
	]);
	for (const [override, message] of [
		[{ LOCAL_POSTGRES_STACK: '0' }, 'dedicated test'],
		[{ GUILD_ALLOW_LIST: '789' }, 'explicitly allowed'],
		[{ VITE_BELLE_BOT_CLIENT_ID: '789' }, 'must match'],
		[{ DISCORD_TOKEN: 'another-token' }, 'same local DISCORD_TOKEN'],
		[{ VITE_DATABASE_URL: 'must-not-be-published' }, 'browser-visible'],
		[{ LOCAL_FUNCTIONS_PATH: 'func.cmd' }, 'native Functions'],
	]) {
		await expect(readConfiguration(override, workspace)).rejects.toThrow(
			message
		);
	}
	await writeFile(
		join(site, '.env.local-postgres.local'),
		'VITE_BELLE_BOT_CLIENT_ID=789\n'
	);
	await expect(readConfiguration({}, workspace)).rejects.toThrow(
		'must match'
	);
});

it('owns only a newly started native cluster and retains data across two launches', async () => {
	await cluster.stop();
	for (let launch = 0; launch < 2; launch++) {
		const stop = await startDatabase(env, records);
		cleanups.push(stop);
		const owned = records.at(-1);
		expect(owned.name).toBe('PostgreSQL');
		expect(
			Number(
				(
					await readFile(
						join(env.LOCAL_POSTGRES_DATA_DIR, 'postmaster.pid'),
						'utf8'
					)
				).split(/\r?\n/)[0]
			)
		).toBe(owned.child.pid);
		expect((await query('SELECT name FROM hunts')).rows[0].name).toBe(
			'Persistent fixture'
		);
		await stop();
		expect(
			await portOpen('127.0.0.1', Number(new URL(env.DATABASE_URL).port))
		).toBe(false);
	}
}, 60000);

it('cleans up an owned database after a schema readiness failure, without changing its data', async () => {
	const stop = await startDatabase(env, records);
	await query('CREATE DATABASE missing_schema');
	await stop();
	await expect(
		startDatabase(
			{
				...env,
				DATABASE_URL: env.DATABASE_URL.replace(
					/postgres$/,
					'missing_schema'
				),
			},
			records
		)
	).rejects.toThrow('schema check failed');
	expect(
		await portOpen('127.0.0.1', Number(new URL(env.DATABASE_URL).port))
	).toBe(false);
	cleanups.push(await startDatabase(env, records));
	expect((await query('SELECT name FROM hunts')).rows[0].name).toBe(
		'Persistent fixture'
	);
}, 30000);

it('cleans up cancellation arriving before a newly started database is ready', async () => {
	await expect(
		startDatabase(
			env,
			records,
			AbortSignal.abort(new Error('Cancelled during startup'))
		)
	).rejects.toThrow('Cancelled during startup');
	expect(records).toHaveLength(1);
	expect(records[0].result).toBeDefined();
	expect(
		await portOpen('127.0.0.1', Number(new URL(env.DATABASE_URL).port))
	).toBe(false);
}, 30000);

it('does not adopt occupied app ports and rejects early exit or missing readiness', async () => {
	const server = createServer((socket) => socket.end('unrelated'));
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	cleanups.push(() => new Promise((resolve) => server.close(resolve)));
	await expect(assertPortFree(server.address().port)).rejects.toThrow(
		'conflicting app'
	);
	const child = startProcess(
		'Early exit fixture',
		process.execPath,
		['-e', 'process.exit(7)'],
		{ output: false }
	);
	records.push(child);
	await child.exited;
	await expect(waitFor('Fixture', () => true, records)).rejects.toThrow(
		'exited'
	);
	await expect(
		waitFor('Wrong readiness', () => false, [], undefined, 150)
	).rejects.toThrow('readiness timed out');
});

it('uses IPC for actual service readiness and graceful Windows-compatible shutdown', async () => {
	cleanups.push(await startDatabase(env, records));
	const port = await availablePort();
	const service = startProcess(
		'HTTP service',
		process.execPath,
		[
			'--import',
			signals,
			join(
				root,
				'packages',
				'puzzlehunt-service',
				'dist',
				'src',
				'index.js'
			),
		],
		{
			ipc: true,
			output: false,
			env: {
				...process.env,
				DATABASE_URL: env.DATABASE_URL,
				PORT: String(port),
				HOST: '127.0.0.1',
				VITE_BELLE_BOT_CLIENT_ID: '123',
				PUZZLEHUNT_SERVICE_TOKEN: 'x'.repeat(32),
				DISCORD_TOKEN: 'local-fixture-token',
			},
		}
	);
	records.push(service);
	await waitFor(
		'HTTP service',
		() => service.ready,
		records,
		undefined,
		15000
	);
	expect((await fetch(`http://127.0.0.1:${port}/liveness`)).status).toBe(200);
	await stopProcess(service, 5000);
	expect(service.result.code).toBe(0);
	expect(await portOpen('127.0.0.1', port)).toBe(false);
	expect(await databaseReady(env.DATABASE_URL)).toBe(true);
}, 30000);

it('kills owned shell/node descendants on startup failure without stopping an unrelated process', async () => {
	const port = await availablePort();
	const unrelatedPort = await availablePort();
	const script = join(directory, 'server.cjs');
	await writeFile(
		script,
		`require('node:net').createServer().listen(Number(process.argv[2]), '127.0.0.1');`
	);
	const unrelated = startProcess(
		'Unrelated fixture',
		process.execPath,
		[script, String(unrelatedPort)],
		{ output: false }
	);
	records.push(unrelated);
	const command = join(
		directory,
		process.platform === 'win32' ? 'server.cmd' : 'server.sh'
	);
	await writeFile(command, `"${process.execPath}" "${script}" ${port}\n`);
	const child = startProcess(
		'Shell tree fixture',
		process.execPath,
		[
			'-e',
			`
		require('node:child_process').spawn(
			${JSON.stringify(
				process.platform === 'win32' ? process.env.ComSpec : '/bin/sh'
			)},
			${JSON.stringify(
				process.platform === 'win32'
					? ['/d', '/s', '/c', command]
					: [command]
			)},
			{ stdio: 'inherit' }
		);
		setInterval(() => {}, 1000);
	`,
		],
		{ output: false }
	);
	records.push(child);
	await waitFor(
		'Fixture listeners',
		async () =>
			(await portOpen('127.0.0.1', port)) &&
			(await portOpen('127.0.0.1', unrelatedPort)),
		records,
		undefined,
		5000
	);
	try {
		await waitFor(
			'Missing readiness',
			() => false,
			records,
			undefined,
			150
		);
	} catch (error) {
		expect(error.message).toContain('readiness timed out');
		await stopProcess(child);
	}
	await waitFor(
		'Owned port release',
		async () => !(await portOpen('127.0.0.1', port)),
		[],
		undefined,
		5000
	);
	expect(await portOpen('127.0.0.1', unrelatedPort)).toBe(true);
});

it('cleans up descendants even when their launcher parent has already exited', async () => {
	const port = await availablePort();
	const child = startProcess(
		'Exited parent fixture',
		process.execPath,
		[
			'-e',
			`
		require('node:child_process').spawn(process.execPath, ['-e',
			"require('node:net').createServer().listen(${port}, '127.0.0.1')"
		], { stdio: 'ignore', detached: process.platform === 'win32' });
		setTimeout(() => process.exit(7), 1500);
	`,
		],
		{ output: false, tree: true }
	);
	records.push(child);
	await waitFor(
		'Descendant',
		() => portOpen('127.0.0.1', port),
		records,
		undefined,
		5000
	);
	await child.exited;
	expect(await portOpen('127.0.0.1', port)).toBe(true);
	await stopProcess(child);
	expect(await portOpen('127.0.0.1', port)).toBe(false);
}, 15000);

it('surfaces failed graceful shutdown and bounds an unresponsive owned child', async () => {
	for (const fail of [true, false]) {
		const child = startProcess(
			'Shutdown fixture',
			process.execPath,
			[
				'--import',
				signals,
				'-e',
				`
				process.on('SIGTERM', () => { ${fail ? 'process.exit(2)' : ''} });
				process.send('local-stack-ready');
				setInterval(() => {}, 1000);
			`,
			],
			{ ipc: true, output: false }
		);
		records.push(child);
		await waitFor('Fixture', () => child.ready, records, undefined, 5000);
		await expect(stopProcess(child, 150)).rejects.toThrow(
			fail ? 'shutdown failure' : 'shutdown timed out'
		);
		expect(child.result).toBeDefined();
	}
});

it('starts real Vite and SWA with a fixture API and leaves no shell/server processes listening', async () => {
	const api = createHttpServer((request, response) => {
		response.setHeader('content-type', 'application/json');
		response.end(
			request.url === '/admin/functions' ? '[]' : '{"fixture":true}'
		);
	});
	await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
	cleanups.push(() => new Promise((resolve) => api.close(resolve)));
	const vitePort = await availablePort();
	const swaPort = await availablePort();
	const environment = {
		...process.env,
		NO_COLOR: '1',
		VITE_BELLE_BOT_CLIENT_ID: '123',
	};
	for (const key of [
		'DATABASE_URL',
		'DISCORD_TOKEN',
		'PUZZLEHUNT_SERVICE_TOKEN',
		'GOOGLE_API_KEY',
	])
		delete environment[key];
	const vite = startProcess(
		'Vite fixture',
		process.execPath,
		[
			join(
				dirname(siteRequire.resolve('vite/package.json')),
				'bin',
				'vite.js'
			),
			'--mode',
			'local-postgres',
			'--host',
			'localhost',
			'--port',
			String(vitePort),
			'--strictPort',
		],
		{
			cwd: join(root, 'packages', 'site'),
			env: { ...environment, HOST: 'localhost', PORT: String(vitePort) },
			output: false,
			tree: true,
		}
	);
	records.push(vite);
	await waitFor(
		'Vite',
		() => /Local:/.test(vite.text),
		records,
		undefined,
		30000
	);
	expect(
		(await fetch(`http://localhost:${vitePort}/@vite/client`)).status
	).toBe(200);
	const swa = startProcess(
		'SWA fixture',
		process.execPath,
		[
			siteRequire.resolve('@azure/static-web-apps-cli/dist/cli/bin.js'),
			'start',
			`http://localhost:${vitePort}`,
			'--api-devserver-url',
			`http://localhost:${api.address().port}`,
			'--host',
			'localhost',
			'--port',
			String(swaPort),
		],
		{
			cwd: join(root, 'packages', 'site'),
			env: { ...environment, HOST: 'localhost', PORT: String(swaPort) },
			output: false,
			tree: true,
		}
	);
	records.push(swa);
	await waitFor(
		'SWA',
		() =>
			swa.text.includes(
				`Azure Static Web Apps emulator started at http://localhost:${swaPort}.`
			),
		records,
		undefined,
		30000
	);
	expect(
		await (await fetch(`http://localhost:${swaPort}/.auth/me`)).json()
	).toEqual({ clientPrincipal: null });
	await stopProcess(swa);
	await stopProcess(vite);
	expect(await portOpen('localhost', swaPort)).toBe(false);
	expect(await portOpen('localhost', vitePort)).toBe(false);
}, 60000);

import { spawn } from 'node:child_process';
import { readFile, realpath, access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createConnection, createServer } from 'node:net';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const botRequire = createRequire(join(root, 'packages', 'bot', 'package.json'));
const siteRequire = createRequire(
	join(root, 'packages', 'site', 'package.json')
);
let parse, Client;
try {
	({ parse } = botRequire('dotenv'));
	({ Client } = botRequire('pg'));
} catch (error) {
	if (error.code !== 'MODULE_NOT_FOUND') throw error;
	throw new Error('Run pnpm install before launching the local stack.');
}
const signals = join(root, 'scripts', 'local-stack-signals.mjs');
const windows = process.platform === 'win32';
const ports = [3000, 3001, 5173, 7071, 9000];

async function localFile(path, description) {
	try {
		return await readFile(path, 'utf8');
	} catch {
		throw new Error(
			`Missing ${description}. See README.md#local-postgresql-stack.`
		);
	}
}

export async function readConfiguration(
	environment = process.env,
	configurationRoot = root
) {
	const env = {
		...parse(
			await localFile(
				join(configurationRoot, '.env'),
				'ignored root .env'
			)
		),
		...environment,
	};
	if (env.LOCAL_POSTGRES_STACK !== '1') {
		throw new Error(
			'Set LOCAL_POSTGRES_STACK=1 only after configuring a dedicated test bot/guild and Google folder.'
		);
	}
	// This is the same opt-in validation used by the bot, not a second backend policy.
	const { readLocalPostgresConfiguration } = await import(
		pathToFileURL(
			join(root, 'packages', 'bot', 'dist', 'local-postgres-config.js')
		)
	);
	const config = readLocalPostgresConfiguration(env);
	if (!config)
		throw new Error(
			'LOCAL_POSTGRES_GUILD_IDS is required for this launch target.'
		);
	const databasePort = Number(new URL(config.databaseUrl).port || 5432);
	if (databasePort === 0 || ports.includes(databasePort)) {
		throw new Error(
			'DATABASE_URL must use a nonzero port distinct from the fixed app ports.'
		);
	}
	const service = new URL(config.serviceBaseUrl);
	if (
		service.protocol !== 'http:' ||
		service.hostname === '[::1]' ||
		service.port !== '3001' ||
		service.pathname !== '/'
	) {
		throw new Error(
			'For this target PUZZLEHUNT_SERVICE_BASE_URL must use http://localhost:3001 or http://127.0.0.1:3001.'
		);
	}
	if (env.VITE_BELLE_BOT_CLIENT_ID !== env.CLIENT_ID) {
		throw new Error(
			'Set root VITE_BELLE_BOT_CLIENT_ID to the local CLIENT_ID.'
		);
	}
	if (env.PUZZLEHUNT_ALLOWED_ORIGINS !== 'http://localhost:9000') {
		throw new Error(
			'Set PUZZLEHUNT_ALLOWED_ORIGINS=http://localhost:9000 for this target.'
		);
	}
	if (!env.DISCORD_TOKEN?.trim())
		throw new Error('DISCORD_TOKEN must be the dedicated test bot token.');
	try {
		const key = JSON.parse(env.GOOGLE_API_KEY);
		if (!key.client_email || !key.private_key) throw new Error();
	} catch {
		throw new Error(
			'GOOGLE_API_KEY must contain test service-account JSON with client_email and private_key.'
		);
	}
	const localBrowser = parse(
		await localFile(
			join(
				configurationRoot,
				'packages',
				'site',
				'.env.local-postgres.local'
			),
			'site .env.local-postgres.local'
		)
	);
	if (localBrowser.VITE_BELLE_BOT_CLIENT_ID !== env.CLIENT_ID) {
		throw new Error(
			'Site .env.local-postgres.local VITE_BELLE_BOT_CLIENT_ID must match the local CLIENT_ID.'
		);
	}
	const { loadEnv } = await import('vite');
	const browser = {
		...loadEnv(
			'local-postgres',
			join(configurationRoot, 'packages', 'site')
		),
		...Object.fromEntries(
			Object.entries(env).filter(([key]) => key.startsWith('VITE_'))
		),
	};
	if (
		[
			'VITE_DATABASE_URL',
			'VITE_PUZZLEHUNT_SERVICE_TOKEN',
			'VITE_DISCORD_TOKEN',
			'VITE_GOOGLE_API_KEY',
		].some((key) => browser[key] !== undefined)
	) {
		throw new Error(
			'Remove server secrets from VITE_ settings; they are browser-visible.'
		);
	}
	if (
		browser.VITE_BELLE_BOT_CLIENT_ID !== env.CLIENT_ID ||
		browser.VITE_BELLE_BOT_BASE_URL !== 'http://localhost:3000' ||
		browser.VITE_PUZZLEHUNT_SERVICE_BASE_URL !== 'http://localhost:3001'
	) {
		throw new Error(
			'Site local-postgres settings must match CLIENT_ID and localhost ports 3000/3001.'
		);
	}
	let settings;
	try {
		settings = JSON.parse(
			await localFile(
				join(
					configurationRoot,
					'packages',
					'site-api',
					'local.settings.json'
				),
				'site-api local.settings.json'
			)
		);
	} catch {
		throw new Error(
			'Create valid ignored packages/site-api/local.settings.json from its sample.'
		);
	}
	if (
		settings.IsEncrypted ||
		settings.Values?.DISCORD_TOKEN !== env.DISCORD_TOKEN ||
		settings.Values?.FUNCTIONS_WORKER_RUNTIME !== 'node'
	) {
		throw new Error(
			'site-api local.settings.json must be unencrypted, use node, and have the same local DISCORD_TOKEN.'
		);
	}
	if (
		!env.LOCAL_FUNCTIONS_PATH ||
		!isAbsolute(env.LOCAL_FUNCTIONS_PATH) ||
		(windows && !env.LOCAL_FUNCTIONS_PATH.toLowerCase().endsWith('.exe'))
	) {
		throw new Error(
			'Set LOCAL_FUNCTIONS_PATH to the installed native Functions Core Tools v4 executable (func.exe on Windows), not a .cmd shim.'
		);
	}
	await access(env.LOCAL_FUNCTIONS_PATH).catch(() => {
		throw new Error(
			'LOCAL_FUNCTIONS_PATH does not exist. Install Azure Functions Core Tools v4 explicitly.'
		);
	});
	if (
		Boolean(env.LOCAL_POSTGRES_DATA_DIR) !== Boolean(env.LOCAL_POSTGRES_BIN)
	) {
		throw new Error(
			'Set both LOCAL_POSTGRES_DATA_DIR and LOCAL_POSTGRES_BIN, or neither to reuse an already-running database.'
		);
	}
	for (const key of ['LOCAL_POSTGRES_DATA_DIR', 'LOCAL_POSTGRES_BIN']) {
		if (env[key] && !isAbsolute(env[key]))
			throw new Error(`${key} must be an absolute path.`);
	}
	return { env, browser, config };
}

export async function portOpen(host, port) {
	return new Promise((resolve, reject) => {
		const socket = createConnection({
			host: host.replace(/^\[|\]$/g, ''),
			port,
		});
		socket.setTimeout(1000);
		socket.once('connect', () => {
			socket.destroy();
			resolve(true);
		});
		socket.once('timeout', () => {
			socket.destroy();
			reject(new Error('Loopback connection timed out.'));
		});
		socket.once('error', (error) => {
			if (error.code === 'ECONNREFUSED') resolve(false);
			else reject(error);
		});
	});
}

export async function assertPortFree(port) {
	// Check both loopback families: localhost may resolve to either one.
	for (const host of ['127.0.0.1', '::1']) {
		await new Promise((resolve, reject) => {
			const server = createServer();
			server.once('error', (error) => {
				if (host === '::1' && error.code === 'EAFNOSUPPORT') resolve();
				else
					reject(
						new Error(
							`Port ${port} is unavailable on ${host}; stop the conflicting app explicitly.`
						)
					);
			});
			server.listen({ host, port, exclusive: true }, () =>
				server.close(resolve)
			);
		});
	}
}

export function startProcess(
	name,
	executable,
	args,
	{
		env = process.env,
		cwd = root,
		ipc = false,
		output = true,
		tree = false,
	} = {}
) {
	const startedAt = Date.now();
	const child = spawn(executable, args, {
		cwd,
		env,
		shell: false,
		windowsHide: true,
		detached: !windows,
		stdio: ['ignore', 'pipe', 'pipe', ...(ipc ? ['ipc'] : [])],
	});
	const record = {
		name,
		child,
		text: '',
		result: undefined,
		stopping: false,
		ready: false,
		startedAt,
		tree,
	};
	const capture = (stream, destination) =>
		stream.on('data', (data) => {
			record.text = (record.text + data.toString()).slice(-16384);
			if (output) destination.write(data);
		});
	capture(child.stdout, process.stdout);
	capture(child.stderr, process.stderr);
	child.on('message', (message) => {
		if (message === 'local-stack-ready') record.ready = true;
	});
	record.exited = new Promise((resolve) => {
		child.once('error', () => {
			record.result = {
				error: `${name} could not start. Check the installed executable and dependencies.`,
			};
			resolve(record.result);
		});
		child.once('exit', (code, signal) => {
			record.result = { code, signal };
			record.exitedAt = Date.now();
			resolve(record.result);
		});
	});
	return record;
}

export async function waitFor(
	name,
	check,
	records = [],
	signal,
	timeoutMs = 60000
) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		signal?.throwIfAborted();
		const failed = records.find(
			(record) => record.result && !record.stopping
		);
		if (failed)
			throw new Error(
				`${failed.name} exited before the stack stopped (${
					failed.result.code ?? 'startup error'
				}).`
			);
		if (await check()) return;
		await delay(100, undefined, { signal });
	}
	throw new Error(
		`${name} readiness timed out. Check its output and configured ports.`
	);
}

async function killTree(record) {
	if (!record.child.pid) return;
	if (windows) {
		// taskkill /T cannot find descendants after their parent exits. Limit this
		// fallback to children born during the owned parent's lifetime, so a
		// subsequently reused parent PID cannot pull unrelated processes in.
		const args = record.result
			? [
					'-NoProfile',
					'-NonInteractive',
					'-Command',
					`
				$ErrorActionPreference = 'Stop'
				$start = [DateTimeOffset]::FromUnixTimeMilliseconds(${record.startedAt}).UtcDateTime
				$end = [DateTimeOffset]::FromUnixTimeMilliseconds(${record.exitedAt}).UtcDateTime
				$children = Get-CimInstance Win32_Process -Filter 'ParentProcessId = ${record.child.pid}' |
					Where-Object { $_.CreationDate.ToUniversalTime() -ge $start -and $_.CreationDate.ToUniversalTime() -le $end }
				foreach ($child in $children) {
					$current = Get-CimInstance Win32_Process -Filter "ProcessId = $($child.ProcessId)"
					if ($current -and $current.CreationDate -eq $child.CreationDate) {
						& taskkill.exe /PID $child.ProcessId /T /F | Out-Null
						if ($LASTEXITCODE -ne 0 -and (Get-Process -Id $child.ProcessId -ErrorAction SilentlyContinue)) {
							throw 'Owned descendant cleanup failed.'
						}
					}
				}
			`,
			  ]
			: ['/PID', String(record.child.pid), '/T', '/F'];
		const kill = startProcess(
			'Owned process cleanup',
			record.result ? 'powershell.exe' : 'taskkill.exe',
			args,
			{ output: false }
		);
		const result = await kill.exited;
		if (result.code !== 0)
			throw new Error(
				`Could not stop owned ${record.name} PID ${record.child.pid}.`
			);
	} else {
		try {
			process.kill(-record.child.pid, 'SIGKILL');
		} catch (error) {
			if (error.code !== 'ESRCH') throw error;
		}
	}
}

export async function stopProcess(record, timeoutMs = 35000) {
	if (record.cleaned) return;
	record.stopping = true;
	if (!record.result) {
		if (record.child.connected) {
			record.child.send('local-stack-stop', (error) => {
				if (error && !record.result)
					console.error(`${record.name} shutdown IPC failed.`);
			});
			await Promise.race([
				record.exited,
				delay(timeoutMs, undefined, { ref: false }),
			]);
			if (!record.result) {
				await killTree(record);
				await record.exited;
				throw new Error(
					`${record.name} graceful shutdown timed out; its owned process tree was terminated. Inspect pending writes before restarting.`
				);
			}
			if (record.result.code !== 0)
				throw new Error(
					`${record.name} reported a shutdown failure (${record.result.code}).`
				);
		} else {
			// SWA/Functions are stateless hosts with shell/worker descendants. Keep
			// their parent alive until the tree kill, including Windows .cmd children.
			await killTree(record);
			await record.exited;
		}
	} else if (record.tree) {
		await killTree(record);
	}
	if (record.child.connected && record.result) record.child.disconnect();
	record.cleaned = true;
}

export async function databaseReady(databaseUrl, inspectDirectory = false) {
	const client = new Client({
		connectionString: databaseUrl,
		connectionTimeoutMillis: 1500,
		statement_timeout: 2000,
	});
	try {
		await client.connect();
		// Read-only probes. Launch must never install or modify the schema.
		await client.query(
			'SELECT 1 FROM hunts, active_hunts, hunt_nodes, hunt_changes, command_receipts, integration_jobs, integration_events, integration_progress LIMIT 0'
		);
		return inspectDirectory
			? (await client.query('SHOW data_directory')).rows[0].data_directory
			: true;
	} finally {
		await client.end();
	}
}

export async function startDatabase(env, records, signal) {
	const url = new URL(env.DATABASE_URL);
	const port = Number(url.port || 5432);
	const host = url.hostname;
	const data = env.LOCAL_POSTGRES_DATA_DIR;
	const executable = (name) =>
		join(env.LOCAL_POSTGRES_BIN, `${name}${windows ? '.exe' : ''}`);
	let owned;
	const stop = async () => {
		if (!owned || owned.result) return;
		// Cancellation can arrive before postgres has written postmaster.pid.
		// Wait for ownership or exit, rather than leaving a just-started server.
		await waitFor(
			'Owned PostgreSQL PID',
			async () => {
				if (owned.result) return true;
				try {
					const pid = (
						await readFile(join(data, 'postmaster.pid'), 'utf8')
					).split(/\r?\n/)[0];
					return Number(pid) === owned.child.pid;
				} catch (error) {
					if (error.code === 'ENOENT') return false;
					throw error;
				}
			},
			[],
			undefined,
			30000
		);
		if (owned.result) return;
		// Never signal a replacement server or a shared pre-existing cluster.
		const pid = (
			await readFile(join(data, 'postmaster.pid'), 'utf8')
		).split(/\r?\n/)[0];
		if (Number(pid) !== owned.child.pid)
			throw new Error(
				'PostgreSQL ownership changed; refusing to stop it.'
			);
		owned.stopping = true;
		const ctl = startProcess('PostgreSQL shutdown', executable('pg_ctl'), [
			'-D',
			data,
			'-m',
			'fast',
			'-w',
			'-t',
			'30',
			'stop',
		]);
		const result = await ctl.exited;
		if (result.code !== 0)
			throw new Error(
				'Owned PostgreSQL shutdown failed; inspect this data directory manually.'
			);
		await owned.exited;
	};
	try {
		if (!(await portOpen(host, port))) {
			if (!data)
				throw new Error(
					'PostgreSQL is not running. Start the configured native instance, or set LOCAL_POSTGRES_DATA_DIR and LOCAL_POSTGRES_BIN.'
				);
			await access(join(data, 'PG_VERSION')).catch(() => {
				throw new Error(
					'LOCAL_POSTGRES_DATA_DIR is not an initialized cluster. Initialize/install PostgreSQL explicitly, never through launch.'
				);
			});
			await access(executable('pg_ctl'));
			await assertPortFree(port);
			owned = startProcess('PostgreSQL', executable('postgres'), [
				'-D',
				data,
				'-h',
				host === '[::1]' ? '::1' : host,
				'-p',
				String(port),
			]);
			records.push(owned);
			await waitFor(
				'PostgreSQL',
				() => portOpen(host, port),
				records,
				signal,
				30000
			);
		}
		let actualData;
		try {
			await waitFor(
				'PostgreSQL SQL',
				async () => {
					try {
						actualData = await databaseReady(
							env.DATABASE_URL,
							Boolean(data)
						);
						return true;
					} catch (error) {
						if (
							owned &&
							['57P03', 'ECONNREFUSED'].includes(error.code)
						)
							return false;
						throw error;
					}
				},
				records,
				signal,
				30000
			);
		} catch {
			if (signal?.aborted) throw signal.reason;
			throw new Error(
				'PostgreSQL authentication/database/schema check failed. Verify DATABASE_URL; create the database and run the existing initializer once for a fresh database. Never reinitialize existing data.'
			);
		}
		if (data) {
			const expected = await realpath(data);
			const actual = await realpath(actualData);
			if (
				windows
					? expected.toLowerCase() !== actual.toLowerCase()
					: expected !== actual
			) {
				throw new Error(
					'The responding PostgreSQL data directory does not match LOCAL_POSTGRES_DATA_DIR.'
				);
			}
		}
		console.log(
			owned
				? 'Using launcher-owned PostgreSQL (persistent data).'
				: 'Reusing PostgreSQL; this launcher will not stop it.'
		);
		return stop;
	} catch (error) {
		try {
			await stop();
		} catch (cleanup) {
			throw new AggregateError(
				[error, cleanup],
				'PostgreSQL startup and cleanup failed.'
			);
		}
		throw error;
	}
}

async function httpReady(url, accept) {
	try {
		const response = await fetch(url, {
			signal: AbortSignal.timeout(1500),
			redirect: 'manual',
		});
		return response.ok && (await accept(response));
	} catch (error) {
		if (error instanceof TypeError || error.name === 'TimeoutError')
			return false;
		throw error;
	}
}

export async function main() {
	const records = [];
	const controller = new AbortController();
	const interrupt = () => controller.abort(new Error('Local stack stopped.'));
	process.once('SIGINT', interrupt);
	process.once('SIGTERM', interrupt);
	let stopDatabase;
	try {
		// Avoid .cmd wrappers: compiler processes are direct Node children.
		for (const name of [
			'puzzlehunt-model',
			'puzzlehunt-service',
			'bot',
			'site-api',
			'site',
		]) {
			const cwd = join(root, 'packages', name);
			const require = createRequire(join(cwd, 'package.json'));
			const build = startProcess(
				`Build ${name}`,
				process.execPath,
				[
					require.resolve('typescript/lib/tsc.js'),
					...(name === 'bot' ? ['--build'] : []),
				],
				{ cwd }
			);
			records.push(build);
			await waitFor(
				build.name,
				() => Boolean(build.result),
				[],
				controller.signal,
				180000
			);
			if (build.result.code !== 0)
				throw new Error(`${build.name} failed.`);
			build.stopping = true;
		}
		const { env, browser } = await readConfiguration();
		for (const port of ports) await assertPortFree(port);
		const version = startProcess(
			'Functions version check',
			env.LOCAL_FUNCTIONS_PATH,
			['--version'],
			{ output: false }
		);
		records.push(version);
		await waitFor(
			version.name,
			() => Boolean(version.result),
			[],
			controller.signal,
			10000
		);
		if (version.result.code !== 0 || !/^4\.\d+\./m.test(version.text)) {
			throw new Error(
				'LOCAL_FUNCTIONS_PATH must run native Azure Functions Core Tools v4. Check its --version output.'
			);
		}
		version.stopping = true;
		stopDatabase = await startDatabase(env, records, controller.signal);
		const node = (name, entry, cwd, childEnv, ipc = true, args = []) => {
			const record = startProcess(
				name,
				process.execPath,
				[
					...(ipc ? ['--import', pathToFileURL(signals).href] : []),
					entry,
					...args,
				],
				{ cwd, env: childEnv, ipc, tree: !ipc }
			);
			records.push(record);
			return record;
		};
		const service = node(
			'Puzzlehunt HTTP service',
			join(
				root,
				'packages',
				'puzzlehunt-service',
				'dist',
				'src',
				'index.js'
			),
			root,
			{ ...env, PORT: '3001', HOST: '127.0.0.1' }
		);
		await waitFor(
			service.name,
			() =>
				service.ready &&
				httpReady(
					'http://127.0.0.1:3001/liveness',
					async (r) => (await r.text()) === 'OK'
				),
			records,
			controller.signal
		);
		const bot = node(
			'Local bot/worker',
			join(root, 'packages', 'bot', 'dist', 'index.js'),
			root,
			{ ...env, PORT: '3000', HOST: '127.0.0.1' }
		);
		await waitFor(
			bot.name,
			() =>
				bot.ready &&
				httpReady(
					'http://127.0.0.1:3000/liveness',
					async (r) => (await r.text()) === 'OK'
				),
			records,
			controller.signal
		);
		// Server credentials are not passed to Vite/SWA. Functions reads its local
		// settings, already checked above against the bot's token.
		const webEnv = { ...process.env, ...browser, BROWSER: 'none' };
		for (const key of [
			'DATABASE_URL',
			'PUZZLEHUNT_SERVICE_TOKEN',
			'DISCORD_TOKEN',
			'GOOGLE_API_KEY',
			'PORT',
			'HOST',
		])
			delete webEnv[key];
		const functions = startProcess(
			'Functions',
			env.LOCAL_FUNCTIONS_PATH,
			['start', '--port', '7071', '--cors', 'http://localhost:9000'],
			{
				cwd: join(root, 'packages', 'site-api'),
				env: { ...webEnv, HOST: 'localhost', PORT: '7071' },
				tree: true,
			}
		);
		records.push(functions);
		await waitFor(
			functions.name,
			() =>
				/Worker process started and initialized/.test(functions.text) &&
				httpReady(
					'http://localhost:7071/admin/host/status',
					async (r) => (await r.json()).state === 'Running'
				),
			records,
			controller.signal,
			120000
		);
		const vite = node(
			'Vite',
			join(
				dirname(siteRequire.resolve('vite/package.json')),
				'bin',
				'vite.js'
			),
			join(root, 'packages', 'site'),
			{ ...webEnv, HOST: 'localhost', PORT: '5173' },
			false,
			[
				'--mode',
				'local-postgres',
				'--host',
				'localhost',
				'--port',
				'5173',
				'--strictPort',
			]
		);
		await waitFor(
			vite.name,
			() =>
				/Local:/.test(vite.text) &&
				httpReady('http://localhost:5173/@vite/client', async (r) =>
					(await r.text()).includes('WebSocket')
				),
			records,
			controller.signal
		);
		const swa = node(
			'SWA',
			siteRequire.resolve('@azure/static-web-apps-cli/dist/cli/bin.js'),
			join(root, 'packages', 'site'),
			{ ...webEnv, HOST: 'localhost', PORT: '9000' },
			false,
			[
				'start',
				'http://localhost:5173',
				'--api-devserver-url',
				'http://localhost:7071',
				'--host',
				'localhost',
				'--port',
				'9000',
			]
		);
		await waitFor(
			swa.name,
			() =>
				/Azure Static Web Apps emulator started at http:\/\/localhost:9000\./.test(
					swa.text.replace(/\u001b\[[0-9;]*m/g, '')
				) &&
				httpReady(
					'http://localhost:9000/.auth/me',
					async (r) => (await r.json()).clientPrincipal === null
				),
			records,
			controller.signal
		);
		console.log(
			'Local PostgreSQL stack ready: http://localhost:9000. Ctrl+C (or VS Code Stop) shuts down owned processes; data is retained.'
		);
		await waitFor(
			'Local stack',
			() => false,
			records,
			controller.signal,
			Infinity
		);
	} catch (error) {
		if (error !== controller.signal.reason && error.name !== 'AbortError') {
			console.error(error.message);
			if (error instanceof AggregateError) {
				for (const cause of error.errors) console.error(cause.message);
			}
			process.exitCode = 1;
		}
	} finally {
		for (const record of [...records].reverse()) {
			if (record.name === 'PostgreSQL') continue;
			try {
				await stopProcess(record);
			} catch (error) {
				console.error(error.message);
				process.exitCode = 1;
			}
		}
		const unsettled = records.some(
			(record) =>
				record.name !== 'PostgreSQL' &&
				(!record.result || (record.tree && !record.cleaned))
		);
		if (unsettled) {
			console.error(
				'Dependent cleanup is incomplete; leaving any owned PostgreSQL running. Stop the remaining dependents before stopping that cluster manually.'
			);
			process.exitCode = 1;
		} else {
			try {
				await stopDatabase?.();
			} catch (error) {
				console.error(error.message);
				process.exitCode = 1;
			}
		}
		process.off('SIGINT', interrupt);
		process.off('SIGTERM', interrupt);
	}
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
	await main();

import { resolve } from 'node:path';
import { REST } from 'discord.js';
import '../register-env/index.js';
import { exportPuzzlehunts } from './exporter.js';
import { loadSnapshot } from './fluid.js';

const usage =
	'Usage: pnpm export:hunts --output <new-directory> [--timeout-ms <milliseconds>]';

function requiredEnvironment(name: string): string {
	const value = process.env[name];
	if (!value || value === 'xxx') {
		throw new Error(
			`Set ${name} in the environment or repository-root .env.`
		);
	}
	return value;
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
		console.log(usage);
		return;
	}
	let output: string | undefined;
	let timeoutMs = 120_000;
	for (let i = 0; i < args.length; i += 2) {
		const value = args[i + 1];
		if (args[i] === '--output' && value && output === undefined) {
			output = value;
		} else if (
			args[i] === '--timeout-ms' &&
			value &&
			/^\d+$/.test(value) &&
			Number.isSafeInteger(Number(value)) &&
			Number(value) > 0 &&
			Number(value) <= 2_147_483_647
		) {
			timeoutMs = Number(value);
		} else {
			throw new Error(usage);
		}
	}
	if (output === undefined) {
		throw new Error(usage);
	}
	const botId = requiredEnvironment('CLIENT_ID');
	const token = requiredEnvironment('DISCORD_TOKEN');
	if (!/^\d+$/.test(botId)) {
		throw new Error('CLIENT_ID must be a Discord bot ID.');
	}
	const local = !!process.env.USE_LOCAL_SERVICE;
	const fluidSource = local
		? { endpoint: 'http://localhost:7070' }
		: {
				endpoint: 'https://us.fluidrelay.azure.com',
				tenantId: requiredEnvironment('FLUID_TENANT_ID'),
		  };
	if (!local) {
		requiredEnvironment('FLUID_PRIMARY_KEY');
	}
	const directory = resolve(output);
	const manifest = await exportPuzzlehunts(directory, {
		botId,
		discord: new REST({ version: '10', timeout: 30_000 }).setToken(token),
		fluidSource,
		loadSnapshot: (id) => loadSnapshot(id, timeoutMs),
	});
	const { discovered, exported, noHunt, failed } = manifest.counts;
	console.log(
		`${
			manifest.complete ? 'Complete' : 'INCOMPLETE'
		} export: ${discovered} guilds, ` +
			`${exported} hunts exported, ${noHunt} without a hunt, ${failed} failed.`
	);
	console.log(`Manifest: ${resolve(directory, 'manifest.json')}`);
	for (const entry of manifest.guilds) {
		if (entry.failure) {
			console.error(
				`Guild ${entry.guild.id} (${entry.failure.stage}): ${entry.failure.message}`
			);
		}
	}
	for (const failure of manifest.failures) {
		console.error(`${failure.stage}: ${failure.message}`);
	}
	if (!manifest.complete) {
		process.exitCode = 1;
	}
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});

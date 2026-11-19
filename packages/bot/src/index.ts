import './register-env/index.js';
import { createClient } from './client.js';
import { createPuzzlehuntProvider } from './puzzlehunt-provider.js';
import { exposeBelleBotApi } from './api.js';
import { readLocalPostgresConfiguration } from './local-postgres-config.js';
import { createLocalPostgresBackend } from './local-postgres.js';

const localConfiguration = readLocalPostgresConfiguration(process.env);
const localPostgres = localConfiguration
	? createLocalPostgresBackend(
			localConfiguration,
			async (guildId) => {
				if (!localConfiguration.guildIds.includes(guildId))
					throw new Error('Unauthorized worker guild.');
				const guild = await client.guilds.fetch(guildId);
				await Promise.all([
					guild.roles.fetch(),
					guild.channels.fetch(),
				]);
				return guild;
			},
			(error, scope) =>
				console.error(
					'Durable integration worker failed.',
					scope,
					error
				)
	  )
	: undefined;
const puzzlehuntProvider = createPuzzlehuntProvider(localPostgres?.documents);
const client = createClient({
	token: process.env.DISCORD_TOKEN,
	puzzlehuntProvider,
	localPostgres,
	allowList: process.env.GUILD_ALLOW_LIST?.split(',').map((id) => id.trim()),
	blockList: process.env.GUILD_BLOCK_LIST?.split(',').map((id) => id.trim()),
});

// Error Handling
process.on('uncaughtException', (err) => {
	console.log('Uncaught Exception: ' + err);
	console.log(err);
});

process.on('unhandledRejection', (reason, promise) => {
	console.log(
		'[FATAL] Possibly Unhandled Rejection at: Promise ',
		promise,
		' reason: ',
		(reason as any).message
	);
});

const server = exposeBelleBotApi(client);
let shutdown: Promise<void> | undefined;
function stop(): Promise<void> {
	return (shutdown ??= (async () => {
		const httpClosed = new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
		});
		const results = await Promise.allSettled([
			httpClosed,
			client.shutdown(),
		]);
		for (const result of results) {
			if (result.status === 'rejected') {
				console.error(
					'Shutdown failed; inspect retained-write diagnostics before restarting.',
					result.reason
				);
				process.exitCode = 1;
			}
		}
	})());
}
process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());

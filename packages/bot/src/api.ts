import express from 'express';
import cors from 'cors';
import { Routes, REST, type Guild } from 'discord.js';
import { BelleBotClient } from './client.js';
import {
	HuntContextError,
	resolveHuntDescriptor,
} from './puzzlehunt-context.js';

async function authorizeMember(token: string, guild: Guild): Promise<boolean> {
	const rest = new REST({ version: '10' }).setToken(token);
	try {
		const userInfo = (await rest.get(Routes.user(), {
			authPrefix: 'Bearer',
		})) as { id: string };
		await guild.members.fetch(userInfo.id);
		return guild.members.cache.has(userInfo.id);
	} catch (error) {
		if (
			error.status === 401 ||
			error.status === 403 ||
			error.status === 404
		)
			return false;
		throw new HuntContextError(
			503,
			'Discord membership verification is unavailable.',
			{ cause: error }
		);
	}
}

/**
 * Constructs the bot metadata API without opening a listener.
 *
 * @remarks
 * `GET /guilds/:guildId/puzzlehunt` requires a Discord bearer token, guild membership,
 * and the bot's guild allow list before resolving a backend pin or contacting the
 * puzzlehunt service. It returns only a `PuzzlehuntDescriptor`, never a live context.
 * JSON errors distinguish unauthorized access (401), missing/out-of-scope guilds or
 * active hunts (404), disabled PostgreSQL (403), invalid/incomplete setup (409), and
 * service or membership-verification failures (503).
 */
export function createBelleBotApi(
	client: BelleBotClient,
	authorize: (
		token: string,
		guild: Guild
	) => Promise<boolean> = authorizeMember
): express.Express {
	const app = express();
	app.use(
		cors({
			origin: [
				'https://localhost:9000',
				'http://localhost:9000',
				'https://purple-smoke-08a64b310.1.azurestaticapps.net',
				'https://belle-puzzles.com',
			],
		})
	);
	// See https://learn.microsoft.com/en-us/azure/container-apps/health-probes?tabs=arm-template
	app.get('/liveness', (_, res) => res.sendStatus(200));
	app.get('/guilds/:guildId/puzzlehunt', async (req, res) => {
		res.set('Cache-Control', 'no-store');
		const authHeader = req.headers.authorization;
		if (!authHeader?.startsWith('Bearer ') || authHeader.length === 7) {
			res.status(401).json({
				body: 'No auth or invalid bearer token provided',
			});
			return;
		}
		const guild = client.guilds.cache.get(req.params.guildId);
		if (!guild || !client.isGuildAllowed(guild.id)) {
			res.status(404).json({
				body: 'Puzzlehunt not found: no matching authorized guild',
			});
			return;
		}
		try {
			if (!(await authorize(authHeader.substring(7), guild))) {
				res.status(401).json({
					body: 'User does not have access to this resource.',
				});
				return;
			}
			const resolved = await resolveHuntDescriptor(client, guild);
			if (!resolved) {
				const hasAdminChannel = guild.channels.cache.some(
					(channel) => channel.name === 'belle-bot-admin'
				);
				res.status(hasAdminChannel ? 409 : 404).json({
					body: hasAdminChannel
						? 'Incomplete hunt setup: no unique valid admin pin.'
						: 'Puzzlehunt not found: no puzzlehunt created on that server.',
				});
				return;
			}
			res.status(200).json(resolved.descriptor);
		} catch (error) {
			console.error('Failed to resolve hunt metadata.', error);
			res.status(
				error instanceof HuntContextError ? error.status : 503
			).json({
				body:
					error instanceof HuntContextError
						? error.message
						: 'Puzzlehunt metadata is unavailable.',
			});
		}
	});
	return app;
}

export function exposeBelleBotApi(client: BelleBotClient) {
	const port = Number(process.env.PORT ?? 3000);
	return createBelleBotApi(client).listen(
		port,
		client.localPostgres ? '127.0.0.1' : '0.0.0.0',
		() => console.log(`Belle-puzzle API listening on port ${port}.`)
	);
}

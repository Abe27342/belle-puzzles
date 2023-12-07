import express from 'express';
import cors from 'cors';
import { Routes, REST } from 'discord.js';
import { BelleBotClient } from './client.js';
import { getHuntContext } from './puzzlehunt-context.js';

export function exposeBelleBotApi(client: BelleBotClient) {
	const app = express();
	const port = process.env.PORT ?? 3000;
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
	app.listen(port, () => {
		console.log(`Belle-puzzle API listening on port ${port}.`);
	});

	// See https://learn.microsoft.com/en-us/azure/container-apps/health-probes?tabs=arm-template
	app.get('/liveness', (_, res) => {
		res.status(200);
	});

	app.get('/guilds/:guildId/puzzlehunt', async (req, res) => {
		const guild = client.guilds.cache.get(req.params.guildId);
		const authHeader = req.headers.authorization;
		if (!authHeader || !authHeader.startsWith('Bearer ')) {
			res.status(400).json({
				body: 'No auth or invalid bearer token provided',
			});
		}
		const userToken = authHeader.substring('Bearer '.length);

		if (!guild) {
			res.status(404).json({
				body: 'Puzzlehunt not found: no matching guild',
			});
			return;
		}

		const rest = new REST({ version: '10' }).setToken(userToken);
		const isUserInGuild = async (): Promise<boolean> => {
			let userInfo: { id: string };
			try {
				userInfo = (await rest.get(Routes.user(), {
					authPrefix: 'Bearer',
				})) as { id: string };
			} catch (err) {
				if (err.status !== 401) {
					console.log(JSON.stringify(err));
				}
				return false;
			}
			await guild.members.fetch(userInfo.id);
			return guild.members.cache.has(userInfo.id);
		};

		try {
			const [context, isAuthorized] = await Promise.all([
				getHuntContext(client, guild),
				isUserInGuild(),
			]);
			if (!isAuthorized) {
				res.status(401).json(
					'User does not have access to this resource.'
				);
				return;
			}

			if (!context) {
				res.status(404).json({
					body: 'Puzzlehunt not found: no puzzlehunt created on that server.',
				});
				return;
			}

			delete context.puzzlehunt;
			res.status(200).json(context);
		} catch (error) {
			console.log(error);
			res.status(500);
		}
	});
}

import { AzureFunction, Context, HttpRequest } from '@azure/functions';
import { Client, GatewayIntentBits } from 'discord.js';

const client = new Client({
	intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});
const discordToken = process.env.DISCORD_TOKEN;

const httpTrigger: AzureFunction = async function (
	context: Context,
	req: HttpRequest
): Promise<void> {
	const guildIdsString = (req.query.guildIds ||
		(req.body && req.body.guildIds)) as string;
	const guildIds = guildIdsString.split(',');
	if (!guildIds || guildIds.length === 0) {
		context.res = {
			status: 400,
			body: 'Request needs comma-separated list of 1 or more guild ids in "guildIds" query param.',
		};
		return;
	}

	await client.login(discordToken);
	context.log('HTTP trigger function processed a request.');
	await client.guilds.fetch();
	const mutualGuilds = guildIds
		.filter((id) => client.guilds.cache.has(id))
		.map((id) => client.guilds.cache.get(id).toJSON());

	context.res = {
		body: { mutualGuilds },
	};
};

export default httpTrigger;

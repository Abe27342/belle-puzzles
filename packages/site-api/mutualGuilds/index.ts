import {
	app,
	InvocationContext as Context,
	HttpRequest,
	HttpResponse,
} from '@azure/functions';
import { Client, GatewayIntentBits } from 'discord.js';

const client = new Client({
	intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});
const discordToken = process.env.DISCORD_TOKEN;

const httpTrigger = async function (
	req: HttpRequest,
	context: Context
): Promise<HttpResponse> {
	let reqBody: { guildIds?: string } | undefined;
	try {
		reqBody = await req.json();
	} catch (err) {
		// Ignore invalid json body
	}

	const guildIdsString = (req.query.get('guildIds') ||
		(reqBody && reqBody?.guildIds)) as string;
	const guildIds = guildIdsString.split(',');
	if (!guildIds || guildIds.length === 0) {
		const response = new HttpResponse({
			status: 400,
			body: 'Request needs comma-separated list of 1 or more guild ids in "guildIds" query param.',
		});
		return response;
	}

	await client.login(discordToken);
	context.log('HTTP trigger function processed a request.');
	await client.guilds.fetch();
	const mutualGuilds = guildIds
		.filter((id) => client.guilds.cache.has(id))
		.map((id) => client.guilds.cache.get(id).toJSON());

	return new HttpResponse({
		status: 200,
		jsonBody: { mutualGuilds },
	});
};

app.http('mutualGuilds', {
	methods: ['GET', 'POST'],
	route: 'discord/userId/mutualGuilds',
	authLevel: 'anonymous',
	handler: httpTrigger,
});

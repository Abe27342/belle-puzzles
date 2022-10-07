// Require the necessary discord.js classes
import './register-env/index.js';
import express from 'express';
import cors from 'cors';
import { NodeId, TreeView } from '@fluid-experimental/tree';
import { assert } from './utils/index.js';
import {
	Collection,
	Guild,
	Interaction,
	MessageManager,
	Routes,
	TextBasedChannel,
	REST,
} from 'discord.js';
import type { PuzzlehuntContext, SerializedPuzzlehuntContext } from './types';
import { BelleBotClient, createClient } from './client.js';
import { createPuzzlehuntProvider } from './puzzlehunt-provider.js';
import {
	IPuzzlehunt,
	Puzzle,
	Round,
	StringNode,
} from '@belle-puzzles/puzzlehunt-model';
import {
	createDiscordAssociation,
	syncRoles,
	syncChannel,
	removeDiscordAssociation,
} from './sync.js';
import { createGoogleSheet } from './integrations/google.js';

const token = process.env.DISCORD_TOKEN;
const client = createClient();
const puzzlehuntProvider = createPuzzlehuntProvider();

// When the client is ready, run this code (only once)
client.once('ready', async () => {
	console.log('Ready!');
});

const PUZZLE_ADMIN_CHANNEL = 'belle-bot-admin';

client.on('channelUpdate', async (oldChannel, newChannel) => {
	console.log(`processing channel update for ${newChannel.id}`);
	try {
		if (newChannel.isDMBased() || oldChannel.isDMBased()) {
			return;
		}

		if (
			newChannel.guildId === process.env.LOCAL_TEST_SERVER_ID &&
			!process.env.TESTING_LOCALLY
		) {
			console.log(
				'ignoring channel update as it is for the local server'
			);
			return;
		}

		if (oldChannel.isTextBased() && newChannel.isTextBased()) {
			if (
				oldChannel.parentId !== newChannel.parentId &&
				newChannel.parentId &&
				oldChannel.parentId
			) {
				const { puzzlehunt } = await getHuntContext(newChannel.guild);
				const puzzle = Array.from(puzzlehunt.puzzles).find(
					(puzzle) => puzzle.discordInfo?.channelId === oldChannel.id
				);
				if (puzzle) {
					const findParentRound = (channelId: string) =>
						Array.from(puzzlehunt.rounds).find(
							(round) =>
								round.discordInfo?.channelId === channelId
						);
					const oldParentRound = findParentRound(oldChannel.parentId);
					const newParentRound = findParentRound(newChannel.parentId);
					if (oldParentRound.id !== newParentRound.id) {
						puzzlehunt.move(puzzle, newParentRound);
					}
				}
			}
		}
	} catch (error) {
		console.log('Unable to process channelUpdate:', error);
	}
});

client.on('interactionCreate', async (interaction) => {
	console.log(`Processing interaction from guild ${interaction.guild.id}`);
	if (
		(interaction.guild.id === process.env.LOCAL_TEST_SERVER_ID &&
			!process.env.TESTING_LOCALLY) ||
		(interaction.guild.id !== process.env.LOCAL_TEST_SERVER_ID &&
			process.env.TESTING_LOCALLY)
	) {
		console.log('ignoring interaction as it is for the local server');
		return;
	}

	// TODO: Handle DMs.
	// TODO: Generally consider usage of deferReply as its a bit jank right now.
	try {
		await runInteraction(interaction);
	} catch (error) {
		console.error(error);
		try {
			if (interaction.isRepliable() && !interaction.replied) {
				await interaction.reply({
					content: 'There was an error while executing this command!',
					ephemeral: true,
				});
			}
		} catch (err) {
			console.log('Failed to notify user of above error:', err);
		}
	}
});

async function runInteraction(interaction: Interaction): Promise<void> {
	const client = interaction.client as BelleBotClient;
	let handler: {
		execute: (
			context: PuzzlehuntContext,
			interaction: Interaction
		) => Promise<void>;
		requiresSerializedContext?: boolean;
	};
	if (interaction.isChatInputCommand()) {
		handler = client.commands.get(interaction.commandName);
	} else if (interaction.isSelectMenu() || interaction.isButton()) {
		handler = client.interactions.get(interaction.customId);
	} else {
		return;
	}

	let context: PuzzlehuntContext;
	if (handler.requiresSerializedContext !== false) {
		context = await getHuntContext(interaction.guild, interaction);
		if (!context) {
			// Don't bother trying to execute the command. Something went wrong getting the context
			// and the command requires it, and this was communicated to the user.
			return;
		}
	}

	await handler.execute(context, interaction);
}

// undefined indicates hunt context could not be found / erroneous state that was communicated
// to the user. Do not dispatch further commands.
async function getHuntContext(
	guild: Guild,
	interaction?: Interaction
): Promise<PuzzlehuntContext | undefined> {
	const metadataChannels = guild.channels.cache.filter(
		(value) => value.name === PUZZLE_ADMIN_CHANNEL && value.isTextBased()
	) as Collection<string, TextBasedChannel>;
	if (metadataChannels.size === 0) {
		if (interaction?.isRepliable()) {
			await interaction.reply(
				'No puzzle hunt was found on this server. Create one with "/create".'
			);
		}
		return;
	}
	if (metadataChannels.size > 1) {
		if (interaction?.isRepliable()) {
			await interaction.reply(
				`Multiple candidate admin channels were found. Please delete any excess channels named "${PUZZLE_ADMIN_CHANNEL}.`
			);
		}
		return;
	}
	const channel = metadataChannels.first();
	const getAdminMessage = () =>
		// cast is necessary due to bad typescript expansion of boolean type.
		(channel.messages as MessageManager<true>).cache.find(
			(message) =>
				message.author.id === process.env.CLIENT_ID && message.pinned
		);
	let adminMessage = getAdminMessage();
	if (!adminMessage) {
		await Promise.all([
			interaction?.isRepliable()
				? interaction.deferReply({ ephemeral: true })
				: Promise.resolve(),
			channel.messages.fetchPinned(),
		]);
		adminMessage = getAdminMessage();
	}
	const context: SerializedPuzzlehuntContext = JSON.parse(
		adminMessage.content
	);
	assert(
		context.name !== undefined && context.fluidFileId !== undefined,
		"Admin message didn't provide the correct context."
	);
	const puzzlehunt = await puzzlehuntProvider.getPuzzlehunt(
		context.fluidFileId,
		(puzzlehunt: IPuzzlehunt) => {
			console.log(
				`Opening file ${context.fluidFileId} and listening for changes.`
			);
			const getGuild = () => client.guilds.cache.get(puzzlehunt.guildId);
			const viewChangeHandler = makeViewChangeHandler(
				{ ...context, puzzlehunt },
				getGuild
			);
			puzzlehunt.on('viewChange', viewChangeHandler);
		}
	);
	return { ...context, puzzlehunt };
}

function makeViewChangeHandler(
	context: PuzzlehuntContext,
	getGuild: () => Guild
) {
	const { puzzlehunt } = context;
	const viewChangeHandler = async (
		before: TreeView,
		after: TreeView,
		// Can return undefined when it's the root note that changed (ex: new root round added)
		getHandle: (
			view: TreeView,
			id: NodeId
		) => StringNode | Puzzle | Round | undefined
	) => {
		const guild = getGuild();
		const delta = before.delta(after);
		const added = delta.added.map((id) => getHandle(after, id));

		const addedNodeIds = new Set(delta.added);
		// TODO: Do something with removed here.
		// TODO: Handle channel drag n drop
		const removed = delta.removed.map((id) => getHandle(before, id));
		const changed = delta.changed.map((id) => ({
			before: getHandle(before, id),
			after: getHandle(after, id),
		}));

		const tasks: Promise<void>[] = [];
		// Note: we explicitly don't delete google sheets here, since it's riskier in case the delete
		// was an accident.
		for (const node of removed) {
			if (node.type === 'puzzle' || node.type === 'round') {
				tasks.push(removeDiscordAssociation(guild, node));
			}
		}

		for (const node of added) {
			if (node.type === 'puzzle' && !node.sheetId) {
				const task = createGoogleSheet(
					node.name,
					context.googleFolderId
				).then((id) => {
					puzzlehunt.augmentWithGoogleSheet(node, id);
				});
				tasks.push(task);
			}

			if (
				(node.type === 'puzzle' || node.type === 'round') &&
				!node.discordInfo
			) {
				tasks.push(createDiscordAssociation(context, guild, node));
			}
		}

		// TODO: Need a task queue to ensure concurrent tasks don't cause issues. If there is overlap between create/delete
		// current code likely can into issues.
		const discordObjectsToSync = new Set<NodeId>();

		// Observation: all operations that we need to act on will show up on the "changed" map,
		// since they're edits of existing rounds/puzzles.
		for (const { after: node, before: beforeNode } of changed) {
			if (node === undefined) {
				continue;
			}

			if (node.type === 'string') {
				// Note: I guess this could reasonably fire for re-solving a puzzle with an existing answer
				// if we went for setPayload instead. But it shouldn't happen now.
				console.log('Unexpected change fired for string handle.');
			} else if (node.discordInfo) {
				discordObjectsToSync.add(node.id);
				if (node.roundId) {
					discordObjectsToSync.add(node.roundId);
				}
			}

			// Moving a node to a new parent in the tree causes the old and new parents to show up in `changed`.
			// In this case we need to update the role assignments on the puzzle to reflect the new tree structure.
			// Random musing, but a lot of this code might be cleaner by a proper dependency system.
			if (
				node.type === 'round' &&
				beforeNode.type === 'round' &&
				node.children.length !== beforeNode.children.length
			) {
				const oldChildren = new Set(
					beforeNode.children.map((child) => child.id)
				);
				const movedChildren = node.children.filter(
					(child) =>
						!oldChildren.has(child.id) &&
						!addedNodeIds.has(child.id)
				);
				tasks.push(
					...movedChildren.map((child) =>
						syncRoles(context, guild, child)
					)
				);
			}
		}
		await Promise.all([
			...Array.from(discordObjectsToSync, (id) => {
				const obj = getHandle(after, id);
				assert(
					obj.type === 'puzzle' || obj.type === 'round',
					'Expected only puzzles and rounds to sync.'
				);
				return syncChannel(context, guild, obj);
			}),
			...tasks,
		]);
	};

	return async (
		before: TreeView,
		after: TreeView,
		getHandle: (
			view: TreeView,
			id: NodeId
		) => StringNode | Puzzle | Round | undefined
	) => {
		try {
			await viewChangeHandler(before, after, getHandle);
		} catch (err) {
			console.log('Error processing viewChange:', err);
		}
	};
}

const app = express();
const port = process.env.PORT ?? 3000;
app.use(
	cors({
		origin: [
			'https://localhost:9000',
			'http://localhost:9000',
			'https://purple-smoke-08a64b310.1.azurestaticapps.net',
		],
	})
);
app.listen(port, () => {
	console.log(`Belle-puzzle API listening on port ${port}.`);
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
			getHuntContext(guild),
			isUserInGuild(),
		]);
		if (!isAuthorized) {
			res.status(401).json('User does not have access to this resource.');
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

client.login(token);

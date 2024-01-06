// Require the necessary discord.js classes
import registerDebug from 'debug';
import {
	Client,
	Collection,
	GatewayIntentBits,
	Interaction,
	NonThreadGuildBasedChannel,
} from 'discord.js';
import * as commandsModule from './commands/index.js';
import * as interactionsModule from './interactions/index.js';
import type { Command } from './commands/types';
import type { InteractionHandler } from './interactions/types';
import {
	getHuntContext,
	type PuzzlehuntContext,
} from './puzzlehunt-context.js';
import { IPuzzlehuntProvider } from './puzzlehunt-provider.js';

const debugTaskqueue = registerDebug('belle-bot:taskqueue');

export type AsyncWorkTypes = 'command' | 'channelUpdate' | 'viewChange';

export interface BelleBotClient extends Client<boolean> {
	commands: Collection<string, Command>;
	interactions: Collection<string, InteractionHandler>;
	puzzlehuntProvider: IPuzzlehuntProvider;
	/**
	 * Pushes a set of asynchronous work onto the client.
	 * Errors will be surfaced as determined by {@link ClientOptions.onError}.
	 */
	pushAsyncWork(
		name: AsyncWorkTypes,
		work: Promise<unknown>,
		interaction?: Interaction
	): void;

	/**
	 * Ensures all pending interactions/commands have been processed.
	 *
	 * This is immediately useful for tests, but may also be useful in the future for production in cases like:
	 * - Graceful shutdown
	 * - Avoiding interleaving of synchronization between fluid file and discord: there are likely race conditions
	 *   in the current logic that are rare enough to not have yet caused issues.
	 *
	 * TODO: maybe want a variant with allSettled instead of 'all'
	 */
	ensurePendingWorkProcessed(): Promise<void>;
}

function getCommandsCollection(): Collection<string, Command> {
	const commands = new Collection<string, Command>();
	for (const commandImport of Object.values(commandsModule)) {
		commands.set(commandImport.data.name, commandImport);
	}
	return commands;
}

function getInteractionsCollection(): Collection<string, InteractionHandler> {
	const interactions = new Collection<string, InteractionHandler>();
	for (const interactionImport of Object.values(interactionsModule)) {
		interactions.set(interactionImport.name, interactionImport);
	}
	return interactions;
}

export interface ClientOptions {
	puzzlehuntProvider: IPuzzlehuntProvider;
	/**
	 * Discord token to use for login.
	 */
	token: string;

	/**
	 * List of server IDs that the bot should process interactions on.
	 * If undefined, the bot will process interactions on all servers it is a member of.
	 */
	allowList?: string[];

	/**
	 * List of server IDs that the bot should ignore interactions on.
	 */
	blockList?: string[];

	/**
	 * Optional base discord client to use rather than initializing a new one.
	 *
	 * This is primarily useful for tests to set up mocks.
	 */
	baseClient?: Client;

	/**
	 * Policy to apply when errors are encountered in interactions or events.
	 *
	 * By default, errors are logged to the console and the user is notified of the error
	 * when the user was performing an interaction.
	 * @returns
	 */
	onError?: (
		error: Error,
		source: AsyncWorkTypes,
		interaction?: Interaction
	) => Promise<void>;
}

export function createClient({
	puzzlehuntProvider,
	token,
	allowList,
	blockList,
	baseClient,
	onError: onErrorArg,
}: ClientOptions): BelleBotClient {
	const client = (baseClient ??
		new Client({ intents: [GatewayIntentBits.Guilds] })) as BelleBotClient;
	const onError = onErrorArg ?? surfaceError;
	client.commands = getCommandsCollection();
	client.interactions = getInteractionsCollection();
	client.puzzlehuntProvider = puzzlehuntProvider;

	const remainingWork: Map<Promise<unknown>, string> = new Map();

	client.pushAsyncWork = (
		name: AsyncWorkTypes,
		work: Promise<unknown>,
		interaction?: Interaction
	): void => {
		debugTaskqueue(`pushing ${name}`);
		remainingWork.set(work, name);
		work.catch((error) => onError(error, name, interaction)).finally(() => {
			remainingWork.delete(work);
		});
	};

	client.ensurePendingWorkProcessed = async () => {
		while (remainingWork.size > 0) {
			if (debugTaskqueue.enabled) {
				debugTaskqueue(
					`awaiting ${remainingWork.size} promises: ${Array.from(
						remainingWork.values()
					).join(', ')}`
				);
			}
			await Promise.all(Array.from(remainingWork.keys()));
		}
	};

	client.once('ready', async () => {
		console.log('Ready!');
	});

	const allowListSet = new Set(allowList);
	const blockListSet = new Set(blockList);
	function shouldProcessInteraction(guildId: string): boolean {
		if (allowListSet.size > 0) {
			return allowListSet.has(guildId);
		}
		return !blockListSet.has(guildId);
	}

	client.on('channelUpdate', (oldChannel, newChannel) => {
		if (
			newChannel.isDMBased() ||
			oldChannel.isDMBased() ||
			!newChannel.isTextBased() ||
			!oldChannel.isTextBased()
		) {
			return;
		}

		if (shouldProcessInteraction(newChannel.guildId)) {
			console.log(
				`Processing channel update for guild: ${newChannel.guildId}, channel: ${newChannel.id}`
			);
		} else {
			console.log(
				`Ignoring channel update for guild: ${newChannel.guildId}`
			);
			return;
		}

		client.pushAsyncWork(
			'channelUpdate',
			runChannelUpdate(oldChannel, newChannel)
		);
	});

	client.on('interactionCreate', (interaction) => {
		if (shouldProcessInteraction(interaction.guild.id)) {
			console.log(
				`Processing interaction for guild: ${interaction.guild.id}`
			);
		} else {
			console.log(
				`Ignoring interaction for guild: ${interaction.guild.id}`
			);
			return;
		}

		client.pushAsyncWork(
			'command',
			// TODO: Handle DMs.
			// TODO: Generally consider usage of deferReply as its a bit jank right now.
			runInteraction(interaction),
			interaction
		);
	});

	async function runChannelUpdate(
		oldChannel: NonThreadGuildBasedChannel,
		newChannel: NonThreadGuildBasedChannel
	): Promise<void> {
		if (
			!newChannel.parentId ||
			!oldChannel.parentId ||
			oldChannel.parentId === newChannel.parentId
		) {
			// Not a reparenting, so nothing to do.
			return;
		}

		const { puzzlehunt } = await getHuntContext(client, newChannel.guild);
		const puzzle = Array.from(puzzlehunt.puzzles).find(
			(puzzle) => puzzle.discordInfo?.channelId === oldChannel.id
		);
		if (!puzzle) {
			return;
		}

		const findParentRound = (channelId: string) =>
			Array.from(puzzlehunt.rounds).find(
				(round) => round.discordInfo?.channelId === channelId
			);
		const oldParentRound = findParentRound(oldChannel.parentId);
		const newParentRound = findParentRound(newChannel.parentId);
		if (oldParentRound.id !== newParentRound.id) {
			puzzlehunt.move(puzzle, newParentRound);
		}
	}

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
			context = await getHuntContext(
				client,
				interaction.guild,
				interaction
			);
			if (!context) {
				// Don't bother trying to execute the command. Something went wrong getting the context
				// and the command requires it, and this was communicated to the user.
				return;
			}
		}

		await handler.execute(context, interaction);
	}

	client.login(token);
	return client;
}

async function surfaceError(
	error: Error,
	source: 'command' | 'channelUpdate' | 'viewChange',
	interaction?: Interaction
): Promise<void> {
	console.error(`Error during ${source}: ${error}`);
	try {
		if (interaction?.isRepliable() && !interaction.replied) {
			await interaction.reply({
				content: `There was an error while executing a ${source}!`,
				ephemeral: true,
			});
		}
	} catch (err) {
		console.log('Failed to notify user of above error:', err, source);
	}
}

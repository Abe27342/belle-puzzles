// Require the necessary discord.js classes
import registerDebug from 'debug';
import {
	Client,
	Collection,
	GatewayIntentBits,
	Interaction,
	MessageFlags,
	NonThreadGuildBasedChannel,
} from 'discord.js';
import * as commandsModule from './commands/index.js';
import * as interactionsModule from './interactions/index.js';
import type { Command } from './commands/types.js';
import type { InteractionHandler } from './interactions/types.js';
import {
	getHuntContext,
	settleHuntContext,
	HuntContextError,
	type PuzzlehuntContext,
} from './puzzlehunt-context.js';
import {
	IPuzzlehuntProvider,
	PendingPostgresWriteError,
} from './puzzlehunt-provider.js';
import type { LocalPostgresBackend } from './local-postgres.js';

const debugTaskqueue = registerDebug('belle-bot:taskqueue');

export type AsyncWorkTypes =
	| 'command'
	| 'channelUpdate'
	| 'viewChange'
	| 'startup';

/**
 * Discord command/event host with backend-aware work admission.
 *
 * @remarks
 * Local PostgreSQL guild commands and channel events serialize within this
 * process, including simultaneous creates. Interactions are deferred before
 * waiting for the queue. This is not a distributed hunt-setup lock.
 */
export interface BelleBotClient extends Client<boolean> {
	commands: Collection<string, Command>;
	interactions: Collection<string, InteractionHandler>;
	puzzlehuntProvider: IPuzzlehuntProvider;
	localPostgres?: LocalPostgresBackend;
	isGuildAllowed(guildId: string): boolean;
	/**
	 * Stop admission, settle visible work, and release owned backend resources.
	 *
	 * @remarks
	 * Admitted commands/events and their error notifications settle before worker
	 * shutdown. The worker releases ownership before provider resources and the
	 * PostgreSQL pool close, followed by the Discord client. Cleanup continues
	 * through failures and rejects with aggregate diagnostics.
	 * The entrypoint closes metadata HTTP admission on SIGINT/SIGTERM alongside
	 * this operation and reports a nonzero exit status on cleanup failure.
	 */
	shutdown(): Promise<void>;
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
	 * Failures are collected after all admitted work and error notifications settle.
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
	localPostgres?: LocalPostgresBackend;
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
	localPostgres,
	token,
	allowList,
	blockList,
	baseClient,
	onError: onErrorArg,
}: ClientOptions): BelleBotClient {
	const client = (baseClient ??
		new Client({ intents: [GatewayIntentBits.Guilds] })) as BelleBotClient;
	if (
		localPostgres &&
		localPostgres.guildIds.some(
			(id) => !allowList?.includes(id) || blockList?.includes(id)
		)
	) {
		throw new Error(
			'Local PostgreSQL requires explicit guild authorization.'
		);
	}
	const onError = onErrorArg ?? surfaceError;
	client.commands = getCommandsCollection();
	client.interactions = getInteractionsCollection();
	client.puzzlehuntProvider = puzzlehuntProvider;
	client.localPostgres = localPostgres;
	let stopping = false;
	let shutdown: Promise<void> | undefined;
	const guildWork = new Map<string, Promise<unknown>>();
	function runGuildWork(
		guildId: string,
		run: () => Promise<void>
	): Promise<void> {
		if (!localPostgres?.guildIds.includes(guildId)) return run();
		const previous = guildWork.get(guildId) ?? Promise.resolve();
		// Previous failures are surfaced by pushAsyncWork; they must not poison later admission.
		const work = previous.then(run, run);
		guildWork.set(guildId, work);
		const release = () => {
			if (guildWork.get(guildId) === work) guildWork.delete(guildId);
		};
		void work.then(release, release);
		return work;
	}

	const remainingWork = new Map<
		Promise<{ error: unknown } | undefined>,
		string
	>();

	client.pushAsyncWork = (
		name: AsyncWorkTypes,
		work: Promise<unknown>,
		interaction?: Interaction
	): void => {
		debugTaskqueue(`pushing ${name}`);
		const tracked = work
			.then(
				(): undefined => undefined,
				async (error) => {
					try {
						await onError(error, name, interaction);
					} catch (notificationError) {
						console.error(
							'Failed to surface asynchronous work error.',
							notificationError,
							error
						);
					}
					return { error };
				}
			)
			.finally(() => {
				remainingWork.delete(tracked);
			});
		remainingWork.set(tracked, name);
	};

	client.ensurePendingWorkProcessed = async () => {
		const failures: unknown[] = [];
		while (remainingWork.size > 0) {
			if (debugTaskqueue.enabled) {
				debugTaskqueue(
					`awaiting ${remainingWork.size} promises: ${Array.from(
						remainingWork.values()
					).join(', ')}`
				);
			}
			const results = await Promise.all(Array.from(remainingWork.keys()));
			for (const result of results)
				if (result !== undefined) failures.push(result.error);
		}
		if (failures.length)
			throw new AggregateError(failures, 'Bot work failed.');
	};

	client.shutdown = () =>
		(shutdown ??= (async () => {
			stopping = true;
			const errors: unknown[] = [];
			for (const close of [
				() => client.ensurePendingWorkProcessed(),
				() => localPostgres?.worker.stop(),
				() => puzzlehuntProvider.close?.(),
				() => localPostgres?.close(),
				() => client.destroy(),
			]) {
				try {
					await close();
				} catch (error) {
					errors.push(error);
				}
			}
			if (errors.length)
				throw new AggregateError(
					errors,
					'Bot shutdown could not settle all work.'
				);
		})());

	client.once('clientReady', () => {
		console.log('Ready!');
		if (!stopping && localPostgres) {
			client.pushAsyncWork(
				'startup',
				(async () => {
					if (client.user?.id !== process.env.CLIENT_ID) {
						throw new Error(
							'Logged-in Discord bot does not match CLIENT_ID; local worker startup refused.'
						);
					}
					await localPostgres.worker.start();
				})()
			);
		}
	});

	const allowListSet = new Set(allowList);
	const blockListSet = new Set(blockList);
	function shouldProcessInteraction(guildId: string): boolean {
		if (allowListSet.size > 0) {
			return allowListSet.has(guildId);
		}
		return !blockListSet.has(guildId);
	}
	client.isGuildAllowed = shouldProcessInteraction;

	client.on('channelUpdate', (oldChannel, newChannel) => {
		if (
			stopping ||
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
			runGuildWork(newChannel.guildId, () =>
				runChannelUpdate(oldChannel, newChannel)
			)
		);
	});

	client.on('interactionCreate', (interaction) => {
		if (stopping || !interaction.guild) return;
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

		const acknowledged =
			localPostgres?.guildIds.includes(interaction.guild.id) &&
			interaction.isRepliable() &&
			!interaction.deferred &&
			!interaction.replied
				? interaction.deferReply({ flags: MessageFlags.Ephemeral })
				: Promise.resolve();
		client.pushAsyncWork(
			'command',
			// TODO: Handle DMs.
			// TODO: Generally consider usage of deferReply as its a bit jank right now.
			acknowledged.then(() =>
				runGuildWork(interaction.guild.id, () =>
					runInteraction(interaction)
				)
			),
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

		const context = await getHuntContext(client, newChannel.guild);
		if (!context) return;
		const { puzzlehunt } = context;
		const puzzle = Array.from(puzzlehunt.puzzles).find(
			(puzzle) => puzzle.discord?.channelId === oldChannel.id
		);
		if (!puzzle) {
			return;
		}

		const findParentRound = (channelId: string) =>
			Array.from(puzzlehunt.rounds).find(
				(round) => round.discord?.channelId === channelId
			);
		const oldParentRound = findParentRound(oldChannel.parentId);
		const newParentRound = findParentRound(newChannel.parentId);
		if (
			oldParentRound &&
			newParentRound &&
			oldParentRound.id !== newParentRound.id
		) {
			puzzlehunt.move(puzzle, newParentRound);
			await settleHuntContext(context);
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
		if (!handler) return;

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

	client.pushAsyncWork('startup', client.login(token));
	return client;
}

async function surfaceError(
	error: Error,
	source: AsyncWorkTypes,
	interaction?: Interaction
): Promise<void> {
	console.error(`Error during ${source}: ${error}`);
	try {
		if (interaction?.isRepliable()) {
			const content =
				error instanceof PendingPostgresWriteError ||
				error instanceof HuntContextError
					? error.message
					: `There was an error while executing a ${source}! No saved-success confirmation is available; inspect the bot logs before repeating the command.`;
			if (interaction.deferred || interaction.replied)
				await interaction.editReply({ content });
			else
				await interaction.reply({
					content,
					flags: MessageFlags.Ephemeral,
				});
		}
	} catch (err) {
		console.log('Failed to notify user of above error:', err, source);
	}
}

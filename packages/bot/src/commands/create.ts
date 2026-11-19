import {
	CacheType,
	ChannelType,
	ChatInputCommandInteraction,
	MessageFlags,
	OverwriteType,
	PermissionsBitField,
	SlashCommandBuilder,
} from 'discord.js';
import { Command } from './types.js';
import {
	PuzzlehuntContext,
	SerializedPuzzlehuntContext,
	HuntContextError,
} from '../puzzlehunt-context.js';
import { createNewPuzzlehunt } from '@belle-puzzles/puzzlehunt-model/fluid';
import { makeFluidClient } from '../fluid/client.js';
import type { BelleBotClient } from '../client.js';
import {
	snowflake,
	type HuntScope,
} from '@belle-puzzles/puzzlehunt-model/document';
import type { PuzzlehuntModel } from '@belle-puzzles/puzzlehunt-model/model';
import {
	parsePuzzlehuntPin,
	type PostgresHuntPin,
} from '@belle-puzzles/puzzlehunt-model/http';
import { settlePostgresModel } from '../puzzlehunt-provider.js';
import { getHuntContextMessage } from '../utils/index.js';

const PUZZLE_ADMIN_CHANNEL = 'belle-bot-admin';
const NAME_ARG = 'name';
const FOLDER_LINK_ARG = 'folder_link';

async function settleResources<T extends readonly unknown[] | []>(work: T) {
	await Promise.allSettled(work);
	return Promise.all(work);
}

/**
 * Creates a hunt using the selected backend and existing Discord provisioning.
 *
 * @remarks
 * PostgreSQL collection creation precedes hunt-level resource provisioning. The
 * complete folder/index/all-role/log-channel configuration is saved through model
 * commands and authoritatively acknowledged before the backend pin and success
 * reply. A changed active selection before pin publication is an incomplete create.
 *
 * Only one untouched initializer seed (revision zero, no nodes, empty configuration)
 * may precede creation; it remains as the sole prior hunt. Existing admin setup,
 * configured/nonempty/modified documents, or multiple prior hunts prevent replacement.
 * The initial document records its folder so a partial/response-lost create cannot
 * masquerade as an initializer seed on retry. Failures require inspection, not
 * automatic setup replay; there is no setup ledger, seed adoption/deletion, or resume.
 */
export const create: Command = {
	requiresSerializedContext: false,
	data: new SlashCommandBuilder()
		.setName('create')
		.addStringOption((builder) =>
			builder
				.setDescription('Name of the puzzle hunt')
				.setName(NAME_ARG)
				.setRequired(true)
		)
		.addStringOption((builder) =>
			builder
				.setDescription(
					'Link to the Google Drive folder to place puzzles in. Be sure to make this folder public + editable.'
				)
				.setName(FOLDER_LINK_ARG)
				.setRequired(true)
		)
		.setDescription(
			'Creates a puzzle hunt in the server it is executed in.'
		),
	async execute(
		_: PuzzlehuntContext,
		interaction: ChatInputCommandInteraction<CacheType>
	) {
		if (interaction.deferred) {
			await interaction.editReply('Creating puzzle hunt...');
		} else {
			await interaction.reply({
				content: 'Creating puzzle hunt...',
				flags: MessageFlags.Ephemeral,
			});
		}
		const { guild } = interaction;
		const client = interaction.client as BelleBotClient;
		const local = client.localPostgres?.guildIds.includes(guild.id)
			? client.localPostgres
			: undefined;
		if (local && !client.isGuildAllowed(guild.id)) {
			throw new HuntContextError(
				403,
				'Local PostgreSQL is not authorized for this guild.'
			);
		}
		const metadataChannels = guild.channels.cache.filter(
			(value) => value.name === PUZZLE_ADMIN_CHANNEL
		);
		if (metadataChannels.size !== 0) {
			const pin = await getHuntContextMessage(guild);
			if (
				pin &&
				'backend' in parsePuzzlehuntPin(JSON.parse(pin.content))
			) {
				throw new HuntContextError(
					local ? 409 : 403,
					local
						? 'An existing PostgreSQL hunt or partial setup was found. Inspect it; do not rerun /create.'
						: 'PostgreSQL is disabled for this existing backend pin. It cannot be replaced with a Fluid hunt.'
				);
			}
			await interaction.editReply(
				'Existing puzzle hunt was found on this server.\n' +
					(local
						? 'Inspect the existing pin and database; deleting the channel is not a PostgreSQL reset or resume.'
						: `If this was a mistake, delete the channel ${PUZZLE_ADMIN_CHANNEL} and rerun.`)
			);
			return;
		}
		const match = interaction.options
			.getString(FOLDER_LINK_ARG)
			.match(
				/https\:\/\/drive\.google\.com\/drive\/folders\/(.*?)\?usp=(sharing|share_link)/
			);
		if (!match || (local && !match[1].trim())) {
			await interaction.editReply(
				'Invalid Google Drive folder link. Please use the link obtained from using "get link" on the folder UI.'
			);
			return;
		}
		const [, googleFolderId] = match;
		let scope: HuntScope | undefined;
		let postgresModel: PuzzlehuntModel | undefined;
		try {
			if (local) {
				const listing = await local.documents.list(guild.id);
				if (listing.hunts.length > 1) {
					throw new Error(
						'Existing or partial PostgreSQL hunts require inspection; refusing replacement.'
					);
				}
				for (const hunt of listing.hunts) {
					const existing = await local.documents.read({
						guildId: snowflake(guild.id),
						huntId: hunt.huntId,
					});
					if (
						!hunt.active ||
						existing.revision !== 0 ||
						Object.keys(existing.document.nodes).length ||
						Object.keys(existing.document.configuration).length
					) {
						throw new Error(
							'Only one untouched, unconfigured empty initializer seed may precede /create.'
						);
					}
				}
				if (!client.puzzlehuntProvider.getPostgresPuzzlehunt) {
					throw new Error(
						'PostgreSQL model provider is unavailable.'
					);
				}
				// Recording the folder in the initial document distinguishes a partial create
				// from the initializer's untouched seed, even if the HTTP response is lost.
				scope = await local.documents.create(guild.id, {
					name: interaction.options.getString(NAME_ARG),
					configuration: { googleFolderId },
				});
				postgresModel =
					await client.puzzlehuntProvider.getPostgresPuzzlehunt(
						scope
					);
			}

			const [adminChannel, indexChannel, logCategory, allPuzzlesRole] =
				await settleResources([
					guild.channels.create({
						name: PUZZLE_ADMIN_CHANNEL,
						permissionOverwrites: [
							{
								id: interaction.guild.id,
								deny: [PermissionsBitField.Flags.ViewChannel],
								type: OverwriteType.Role,
							},
							{
								id: interaction.client.user,
								allow: [PermissionsBitField.Flags.ViewChannel],
								type: OverwriteType.Member,
							},
						],
					}),
					guild.channels.create({
						type: ChannelType.GuildCategory,
						name: 'Puzzle Index',
					}),
					guild.channels.create({
						type: ChannelType.GuildCategory,
						name: 'Logs',
					}),
					guild.roles.create({
						name: 'All Puzzles',
						mentionable: false,
					}),
				]);

			const [addSolveChannel, updateChannel] = await settleResources([
				guild.channels.create({
					name: 'puzzle-add-solves',
					permissionOverwrites: [
						{
							id: interaction.guild.id,
							deny: [PermissionsBitField.Flags.SendMessages],
							type: OverwriteType.Role,
						},
						{
							id: interaction.client.user,
							allow: [PermissionsBitField.Flags.SendMessages],
							type: OverwriteType.Member,
						},
					],
					parent: logCategory,
				}),
				guild.channels.create({
					name: 'puzzle-updates',
					permissionOverwrites: [
						{
							id: interaction.guild.id,
							deny: [PermissionsBitField.Flags.SendMessages],
							type: OverwriteType.Role,
						},
						{
							id: interaction.client.user,
							allow: [PermissionsBitField.Flags.SendMessages],
							type: OverwriteType.Member,
						},
					],
					parent: logCategory,
				}),
			]);

			if (local) {
				postgresModel.dispatch({
					type: 'update-configuration',
					configuration: {
						googleFolderId,
						indexId: snowflake(indexChannel.id),
						allPuzzlesRoleId: snowflake(allPuzzlesRole.id),
						loggingChannelIds: {
							puzzleAdd: snowflake(addSolveChannel.id),
							puzzleSolve: snowflake(addSolveChannel.id),
							puzzleStatusUpdate: snowflake(updateChannel.id),
						},
					},
				});
				await settlePostgresModel(postgresModel);
				const active = await local.documents.readActive(guild.id);
				if (active.huntId !== scope.huntId) {
					throw new Error(
						'Active selection changed during creation; inspect before publishing a pin.'
					);
				}
				const marker: PostgresHuntPin = {
					version: 1,
					backend: 'postgres',
					guildId: guild.id,
				};
				const message = await adminChannel.send(JSON.stringify(marker));
				await message.pin();
				await interaction.editReply('Puzzle hunt created!');
				return;
			}

			const { id, session } = await createNewPuzzlehunt(
				makeFluidClient(),
				interaction.guild.id,
				{
					puzzleAdd: addSolveChannel.id,
					puzzleSolve: addSolveChannel.id,
					puzzleStatusUpdate: updateChannel.id,
				}
			);
			try {
				await session.puzzlehunt.flush();
			} finally {
				session.close();
			}

			const context: SerializedPuzzlehuntContext = {
				name: interaction.options.getString(NAME_ARG),
				indexId: indexChannel.id,
				fluidFileId: id,
				googleFolderId,
				allPuzzlesRoleId: allPuzzlesRole.id,
			};
			// TODO: Maybe explain this better with starter message.
			const message = await adminChannel.send(JSON.stringify(context));
			await message.pin();

			await interaction.editReply('Puzzle hunt created!');
		} catch (error) {
			if (!local) throw error;
			throw new HuntContextError(
				409,
				`PostgreSQL creation did not complete${
					scope ? ` (hunt ${scope.huntId})` : ''
				}. ` +
					'Setup may be partial or the service outcome uncertain. Inspect the database, admin channel, and bot logs; do not rerun /create. ' +
					(error instanceof Error ? error.message : ''),
				{ cause: error }
			);
		}
	},
};

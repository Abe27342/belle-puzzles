import {
	CacheType,
	ChannelType,
	ChatInputCommandInteraction,
	OverwriteType,
	PermissionsBitField,
	SlashCommandBuilder,
} from 'discord.js';
import { Command } from './types';
import {
	PuzzlehuntContext,
	SerializedPuzzlehuntContext,
} from '../puzzlehunt-context';
import { createNewPuzzlehunt } from '@belle-puzzles/puzzlehunt-model';
import { makeFluidClient } from '../fluid/client.js';

const PUZZLE_ADMIN_CHANNEL = 'belle-bot-admin';
const NAME_ARG = 'name';
const FOLDER_LINK_ARG = 'folder_link';

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
		await interaction.reply({
			content: 'Creating puzzle hunt...',
			ephemeral: true,
		});
		const { guild } = interaction;
		const metadataChannels = guild.channels.cache.filter(
			(value) => value.name === PUZZLE_ADMIN_CHANNEL
		);
		if (metadataChannels.size !== 0) {
			await interaction.editReply(
				'Existing puzzle hunt was found on this server.\n' +
					`If this was a mistake, delete the channel ${PUZZLE_ADMIN_CHANNEL} and rerun.`
			);
			return;
		}
		const match = interaction.options
			.getString(FOLDER_LINK_ARG)
			.match(
				/https\:\/\/drive\.google\.com\/drive\/folders\/(.*?)\?usp=(sharing|share_link)/
			);
		if (!match) {
			await interaction.editReply(
				'Invalid Google Drive folder link. Please use the link obtained from using "get link" on the folder UI.'
			);
			return;
		}
		const [, googleFolderId] = match;

		const [adminChannel, indexChannel, logCategory, allPuzzlesRole] =
			await Promise.all([
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

		const [addSolveChannel, updateChannel] = await Promise.all([
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

		const { id, disposer } = await createNewPuzzlehunt(
			makeFluidClient(),
			interaction.guild.id,
			{
				puzzleAdd: addSolveChannel.id,
				puzzleSolve: addSolveChannel.id,
				puzzleStatusUpdate: updateChannel.id,
			}
		);

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

		disposer.dispose();
		await interaction.editReply('Puzzle hunt created!');
	},
};

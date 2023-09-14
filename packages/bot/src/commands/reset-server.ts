import {
	CacheType,
	ChannelType,
	ChatInputCommandInteraction,
	SlashCommandBuilder,
} from 'discord.js';
import { Command } from './types';
import { PuzzlehuntContext } from '../puzzlehunt-context';
import { BELLE_USER_ID } from '../utils/index.js';

export const resetServer: Command = {
	requiresSerializedContext: false,
	testServerOnly: true,
	data: new SlashCommandBuilder()
		.setName('reset_server')
		.setDescription(
			'Debug utility to reset a server to only having a general channel.'
		),
	async execute(
		_: PuzzlehuntContext,
		interaction: ChatInputCommandInteraction<CacheType>
	) {
		if (interaction.channel.name !== 'general') {
			await interaction.reply({
				content: 'Please run this command from the general channel.',
				ephemeral: true,
			});
			return;
		}
		if (!interaction.deferred) {
			await interaction.deferReply({ ephemeral: true });
		}
		try {
			await interaction.editReply('Deleting channels...');
			await Promise.all([
				...interaction.guild.channels.cache
					.filter(
						(channel) =>
							[
								ChannelType.GuildCategory,
								ChannelType.GuildText,
							].includes(channel.type) &&
							channel.name !== 'general'
					)
					.map(async (channel) => channel.delete()),
			]);

			await interaction.editReply('Deleting roles...');

			await Promise.all([
				...interaction.guild.roles.cache
					.filter(
						(role) =>
							role.editable &&
							role.client.user.id === BELLE_USER_ID &&
							role.name !== '@everyone'
					)
					.map((role) => role.delete()),
			]);
		} catch (error) {
			console.log(error);
		}
		await interaction.editReply('Success!');
	},
};

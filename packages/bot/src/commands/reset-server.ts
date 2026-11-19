import {
	CacheType,
	ChannelType,
	ChatInputCommandInteraction,
	MessageFlags,
	SlashCommandBuilder,
} from 'discord.js';
import { Command } from './types.js';
import { PuzzlehuntContext, HuntContextError } from '../puzzlehunt-context.js';
import { BELLE_USER_ID, getHuntContextMessage } from '../utils/index.js';
import { parsePuzzlehuntPin } from '@belle-puzzles/puzzlehunt-model/http';
import type { BelleBotClient } from '../client.js';

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
		const client = interaction.client as BelleBotClient;
		if (client.localPostgres?.guildIds.includes(interaction.guildId)) {
			throw new HuntContextError(
				409,
				'/reset_server is disabled in local PostgreSQL guilds to preserve durable resource associations.'
			);
		}
		const pin = await getHuntContextMessage(interaction.guild);
		if (pin && 'backend' in parsePuzzlehuntPin(JSON.parse(pin.content))) {
			throw new HuntContextError(
				409,
				'/reset_server cannot delete resources belonging to a PostgreSQL backend pin, even when PostgreSQL is disabled.'
			);
		}
		if (
			!pin &&
			interaction.guild.channels.cache.some(
				(channel) => channel.name === 'belle-bot-admin'
			)
		) {
			throw new HuntContextError(
				409,
				'Cannot reset a server with an incomplete or ambiguous admin pin.'
			);
		}
		if (interaction.channel.name !== 'general') {
			await interaction.reply({
				content: 'Please run this command from the general channel.',
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		if (!interaction.deferred) {
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });
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

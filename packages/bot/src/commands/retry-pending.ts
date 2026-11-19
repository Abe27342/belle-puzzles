import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { isUuid, snowflake } from '@belle-puzzles/puzzlehunt-model/document';
import type { Command } from './types.js';
import type { BelleBotClient } from '../client.js';
import { HuntContextError } from '../puzzlehunt-context.js';

export const retryPending: Command = {
	adminOnly: true,
	testServerOnly: true,
	requiresSerializedContext: false,
	data: new SlashCommandBuilder()
		.setName('retry_pending')
		.setDescription(
			'Retry retained PostgreSQL writes with their original command IDs (not hunt setup).'
		)
		.setDefaultMemberPermissions('0')
		.addStringOption((option) =>
			option
				.setName('hunt_id')
				.setDescription('Exact hunt UUID reported by the failed write')
				.setRequired(true)
		),
	async execute(_, interaction) {
		const client = interaction.client as BelleBotClient;
		if (
			!client.localPostgres?.guildIds.includes(interaction.guildId) ||
			!client.isGuildAllowed(interaction.guildId)
		) {
			throw new HuntContextError(
				403,
				'Local PostgreSQL is disabled for this guild.'
			);
		}
		const admin = interaction.guild.channels.cache.filter(
			(channel) => channel.name === 'belle-bot-admin'
		);
		if (admin.size !== 1 || admin.first().id !== interaction.channelId) {
			throw new HuntContextError(
				403,
				'Retry retained writes from the unique belle-bot-admin channel.'
			);
		}
		const huntId = interaction.options.getString('hunt_id');
		if (!isUuid(huntId))
			throw new HuntContextError(
				400,
				'Expected an exact lowercase hunt UUID.'
			);
		if (!client.puzzlehuntProvider.retryPostgresPending)
			throw new Error('PostgreSQL provider unavailable.');
		if (!interaction.deferred) {
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		}
		await client.puzzlehuntProvider.retryPostgresPending({
			guildId: snowflake(interaction.guildId),
			huntId,
		});
		await interaction.editReply(
			'Retained writes settled and the model refreshed. This does not resume hunt setup or paused external integrations.'
		);
	},
};

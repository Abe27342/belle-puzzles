import {
	CacheType,
	ChatInputCommandInteraction,
	MessageFlags,
	SlashCommandBuilder,
} from 'discord.js';
import { Command } from './types.js';
import { PuzzlehuntContext } from '../puzzlehunt-context.js';
import { resyncServerFull } from '../sync/sync.js';
import type { BelleBotClient } from '../client.js';
import { HuntContextError } from '../puzzlehunt-context.js';

export const syncAll: Command = {
	adminOnly: true,
	data: new SlashCommandBuilder()
		.setName('sync_all')
		.setDescription(
			'Debug utility to resync a discord server to reflect the state of the backing file.'
		),
	async execute(
		context: PuzzlehuntContext,
		interaction: ChatInputCommandInteraction<CacheType>
	) {
		if (context.huntContextMessage.channelId !== interaction.channelId) {
			const content =
				'This command can only be run from the admin channel.';
			if (interaction.deferred) await interaction.editReply({ content });
			else
				await interaction.reply({
					content,
					flags: MessageFlags.Ephemeral,
				});
			return;
		}
		if (!interaction.deferred) {
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		}
		await interaction.editReply(
			'Re-syncing all discord state to reflect the puzzle hunt. This may take a while...'
		);
		if (context.backend === 'postgres') {
			const client = interaction.client as BelleBotClient;
			if (
				!client.localPostgres?.guildIds.includes(interaction.guildId) ||
				!client.isGuildAllowed(interaction.guildId)
			) {
				throw new HuntContextError(
					403,
					'PostgreSQL reconciliation is disabled for this guild.'
				);
			}
			await client.localPostgres.worker.reconcile();
		} else {
			try {
				await resyncServerFull(context, interaction.guild);
			} catch (err) {
				await interaction.editReply(
					'Something went wrong while resyncing.'
				);
				return;
			}
		}
		await interaction.editReply('Complete!');
	},
};

export const resyncAll: Command = {
	...syncAll,
	testServerOnly: true,
	data: new SlashCommandBuilder()
		.setName('resync_all')
		.setDescription(
			'Request a durable reconciliation pass for a local PostgreSQL hunt.'
		),
	async execute(context, interaction) {
		if (context.backend !== 'postgres') {
			throw new HuntContextError(409, 'Use /sync_all for a Fluid hunt.');
		}
		await syncAll.execute(context, interaction);
	},
};

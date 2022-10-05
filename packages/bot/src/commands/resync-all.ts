import {
	CacheType,
	ChatInputCommandInteraction,
	SlashCommandBuilder,
} from 'discord.js';
import { Command } from './types';
import { PuzzlehuntContext } from '../types';
import { resyncServerFull } from '../sync.js';

export const syncAll: Command = {
	data: new SlashCommandBuilder()
		.setName('sync_all')
		.setDescription(
			'Debug utility to resync a discord server to reflect the state of the backing file.'
		),
	async execute(
		context: PuzzlehuntContext,
		interaction: ChatInputCommandInteraction<CacheType>
	) {
		if (!interaction.deferred) {
			await interaction.deferReply({ ephemeral: true });
		}
		await interaction.editReply(
			'Re-syncing all discord state to reflect the Fluid file. This may take a while...'
		);
		try {
			await resyncServerFull(context, interaction.guild);
		} catch (err) {
			await interaction.editReply(
				'Something went wrong while resyncing.'
			);
			return;
		}
		await interaction.editReply('Complete!');
	},
};

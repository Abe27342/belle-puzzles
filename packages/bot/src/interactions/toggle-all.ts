import { ButtonInteraction } from 'discord.js';
import { PuzzlehuntContext } from '../types.js';
import { InteractionHandler } from './types';

export const toggleAll: InteractionHandler = {
	name: 'toggleAll',
	async execute(
		{ allPuzzlesRoleId }: PuzzlehuntContext,
		interaction: ButtonInteraction
	) {
		if (!interaction.deferred) {
			await interaction.deferReply({ ephemeral: true });
		}

		const member = await interaction.guild.members.fetch(
			interaction.user.id
		);

		if (member.roles.cache.has(allPuzzlesRoleId)) {
			await member.roles.remove(allPuzzlesRoleId);
			await interaction.editReply('Removed the "all channels" role.');
		} else {
			await member.roles.add(allPuzzlesRoleId);
			await interaction.editReply('All channels are now visible.');
		}
	},
};

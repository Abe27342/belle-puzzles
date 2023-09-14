import { ButtonInteraction } from 'discord.js';
import { PuzzlehuntContext } from '../puzzlehunt-context.js';
import { InteractionHandler } from './types';

export const toggleRound: InteractionHandler = {
	name: 'toggleRound',
	async execute(
		{ puzzlehunt }: PuzzlehuntContext,
		interaction: ButtonInteraction
	) {
		if (!interaction.deferred) {
			await interaction.deferReply({ ephemeral: true });
		}

		const member = await interaction.guild.members.fetch(
			interaction.user.id
		);

		const round = Array.from(puzzlehunt.rounds).find(
			(round) =>
				round.discordInfo.indexChannelId === interaction.channel.id
		);
		const role = round.discordInfo.roleId;

		if (member.roles.cache.has(role)) {
			await member.roles.remove(role);
			await interaction.editReply(
				'Only selected puzzles in this round will now be visible.'
			);
		} else {
			await member.roles.add(role);
			await interaction.editReply(
				'All puzzles in this round are now visible.'
			);
		}
	},
};

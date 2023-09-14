import { NodeId } from '@fluid-experimental/tree';
import { SelectMenuInteraction } from 'discord.js';
import { getAncestorRounds } from '../utils/index.js';
import { PuzzlehuntContext } from '../puzzlehunt-context.js';
import { InteractionHandler } from './types';

export const makePuzzleInvisible: InteractionHandler = {
	name: 'makePuzzleInvisible',
	async execute(
		{ puzzlehunt }: PuzzlehuntContext,
		interaction: SelectMenuInteraction
	) {
		if (!interaction.deferred) {
			await interaction.deferReply({ ephemeral: true });
		}

		if (interaction.values.length === 0) {
			await interaction.message.edit('');
			await interaction.editReply('No channels selected.');
			return;
		}

		const member = await interaction.guild.members.fetch(
			interaction.user.id
		);

		const puzzleIds = interaction.values.map(
			(strPuzzleId) => Number.parseInt(strPuzzleId) as NodeId
		);

		const roles = puzzleIds.map((puzzleId) => {
			const puzzle = puzzlehunt.getPuzzle(puzzleId);
			return interaction.guild.roles.cache.get(puzzle.discordInfo.roleId);
		});

		// In addition to removing role for the puzzle, also remove "all puzzles in a round" role for all ancestors
		// Rationale: intent is to hide these puzzles. Just removing the role won't do it. User can always add back
		// just the ones they cared about if they want.
		const parent = puzzlehunt.getRound(
			puzzlehunt.getPuzzle(puzzleIds[0]).roundId
		);

		await member.roles.remove([
			...roles,
			...getAncestorRounds(puzzlehunt, parent)
				.map((round) => round.discordInfo.roleId)
				.filter((roleId) => member.roles.cache.has(roleId)),
		]);
		await interaction.message.edit('');
		await interaction.editReply(
			`Unsubscribed from ${interaction.values.length} channel${
				interaction.values.length !== 1 ? 's' : ''
			}.`
		);
	},
};

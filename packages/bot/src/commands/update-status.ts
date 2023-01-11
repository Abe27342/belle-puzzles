import {
	CacheType,
	ChatInputCommandInteraction,
	SlashCommandBuilder,
} from 'discord.js';
import { PuzzlehuntContext } from '../types';
import { Command } from './types';

const STATUS_ARG = 'status';

export const updateStatus: Command = {
	data: new SlashCommandBuilder()
		.setName('update_status')
		.addStringOption((builder) =>
			builder
				.setDescription(
					'Current status for this puzzle. Leave empty to clear status. Status will be auto-cleared on solve.'
				)
				.setName(STATUS_ARG)
		)
		.setDescription("Updates a puzzle's status."),
	async execute(
		{ puzzlehunt }: PuzzlehuntContext,
		interaction: ChatInputCommandInteraction<CacheType>
	) {
		if (!interaction.deferred) {
			await interaction.deferReply({ ephemeral: true });
		}

		const matchingPuzzles = Array.from(puzzlehunt.puzzles).filter(
			(puzzle) => puzzle.discordInfo?.channelId === interaction.channelId
		);

		if (matchingPuzzles.length === 0) {
			await interaction.editReply(
				'No puzzle is associated with this channel!'
			);
			return;
		}

		let [puzzle] = matchingPuzzles;
		const status = interaction.options.getString(STATUS_ARG);
		if (!!status) {
			puzzlehunt.updateStatus(puzzle, status);
		} else {
			puzzlehunt.clearStatus(puzzle);
		}

		if (puzzlehunt.loggingChannelIds) {
			const { puzzleStatusUpdate } = puzzlehunt.loggingChannelIds;
			const channel =
				interaction.guild.channels.cache.get(puzzleStatusUpdate);
			if (channel?.isTextBased()) {
				await channel.send(
					!!status
						? `Status updated for ${puzzle.name}: "${status}".`
						: `Status cleared for ${puzzle.name}.`
				);
			}
		}

		await interaction.editReply('Puzzle status updated.');
	},
};

import {
	CacheType,
	ChatInputCommandInteraction,
	MessageFlags,
	SlashCommandBuilder,
} from 'discord.js';
import { PuzzlehuntContext } from '../puzzlehunt-context.js';
import { Command } from './types.js';
import { puzzleStatusMessage } from '../sync/logs.js';

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
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		}

		const matchingPuzzles = Array.from(puzzlehunt.puzzles).filter(
			(puzzle) => puzzle.discord?.channelId === interaction.channelId
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
				await channel.send(puzzleStatusMessage(puzzle.name, status));
			}
		}

		await interaction.editReply('Puzzle status updated.');
	},
};

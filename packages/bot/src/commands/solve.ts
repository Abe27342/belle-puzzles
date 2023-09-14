import {
	CacheType,
	ChatInputCommandInteraction,
	SlashCommandBuilder,
} from 'discord.js';
import { PuzzlehuntContext } from '../puzzlehunt-context';
import { Command } from './types';

const ANSWER_ARG = 'answer';

export const solve: Command = {
	data: new SlashCommandBuilder()
		.setName('solve')
		.addStringOption((builder) =>
			builder
				.setDescription('Answer to the puzzle')
				.setName(ANSWER_ARG)
				.setRequired(true)
		)
		.setDescription('Marks a puzzle as solved with the provided answer.'),
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
		const answer = interaction.options.getString(ANSWER_ARG);
		puzzlehunt.solve(puzzle.id, answer);
		if (puzzle.status !== undefined) {
			puzzlehunt.clearStatus(puzzle);
		}

		if (puzzlehunt.loggingChannelIds) {
			const { puzzleSolve } = puzzlehunt.loggingChannelIds;
			const channel = interaction.guild.channels.cache.get(puzzleSolve);
			if (channel?.isTextBased()) {
				await channel.send(
					`${puzzle.name} solved! Answer: "${answer}".`
				);
			}
		}

		await interaction.editReply(`Puzzle solved with "${answer}".`);
	},
};

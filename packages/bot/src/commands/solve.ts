import {
	CacheType,
	ChatInputCommandInteraction,
	MessageFlags,
	SlashCommandBuilder,
} from 'discord.js';
import { PuzzlehuntContext, settleHuntContext } from '../puzzlehunt-context.js';
import { Command } from './types.js';
import { puzzleSolvedMessage } from '../sync/logs.js';

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
		context: PuzzlehuntContext,
		interaction: ChatInputCommandInteraction<CacheType>
	) {
		const { puzzlehunt } = context;
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
		const answer = interaction.options.getString(ANSWER_ARG);
		puzzlehunt.solve(puzzle.id, answer);
		if (context.backend !== 'postgres' && puzzle.status !== undefined) {
			puzzlehunt.clearStatus(puzzle);
		}

		await settleHuntContext(context);
		if (context.backend !== 'postgres' && puzzlehunt.loggingChannelIds) {
			const { puzzleSolve } = puzzlehunt.loggingChannelIds;
			const channel = interaction.guild.channels.cache.get(puzzleSolve);
			if (channel?.isTextBased()) {
				await channel.send(puzzleSolvedMessage(puzzle.name, answer));
			}
		}

		await interaction.editReply(`Puzzle solved with "${answer}".`);
	},
};

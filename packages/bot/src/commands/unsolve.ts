import {
	CacheType,
	ChatInputCommandInteraction,
	MessageFlags,
	SlashCommandBuilder,
} from 'discord.js';
import { PuzzlehuntContext, settleHuntContext } from '../puzzlehunt-context.js';
import { Command } from './types.js';

export const unsolve: Command = {
	data: new SlashCommandBuilder()
		.setName('unsolve')
		.setDescription(
			'Un-solves a puzzle that was erroneously marked solved.'
		),
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
		if (context.backend === 'postgres') {
			puzzlehunt.unsolve(puzzle.id);
		} else {
			puzzlehunt.solve(puzzle.id, undefined);
		}

		await settleHuntContext(context);
		await interaction.editReply('Success!');
	},
};

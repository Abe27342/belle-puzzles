import {
	CacheType,
	ChatInputCommandInteraction,
	SlashCommandBuilder,
} from 'discord.js';
import { PuzzlehuntContext } from '../types';
import { Command } from './types';

export const unsolve: Command = {
	data: new SlashCommandBuilder()
		.setName('unsolve')
		.setDescription(
			'Un-solves a puzzle that was erroneously marked solved.'
		),
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
		puzzlehunt.solve(puzzle.id, undefined);

		await interaction.editReply('Success!');
	},
};

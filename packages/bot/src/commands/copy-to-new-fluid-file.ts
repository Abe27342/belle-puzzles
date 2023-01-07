import {
	CacheType,
	ChatInputCommandInteraction,
	SlashCommandBuilder,
} from 'discord.js';
import { Command } from './types';
import { PuzzlehuntContext } from '../types';
import { createNewPuzzlehuntFromExisting } from '@belle-puzzles/puzzlehunt-model';
import { makeFluidClient } from '../fluid/client.js';

export const copyToNewFluidFile: Command = {
	adminOnly: true,
	data: new SlashCommandBuilder()
		.setName('copy_to_new_fluid_file')
		.setDescription(
			'Copies the current puzzle hunt into a new file. Workaround for Fluid summarization issues.'
		),
	async execute(
		context: PuzzlehuntContext,
		interaction: ChatInputCommandInteraction<CacheType>
	) {
		await interaction.editReply({
			content: 'Creating new fluid file using the existing hunt data...',
		});

		if (context.huntContextMessage.channelId !== interaction.channelId) {
			await interaction.editReply({
				content: 'This command can only be run from the admin channel.',
			});
			return;
		}

		const { disposer, id } = await createNewPuzzlehuntFromExisting(
			makeFluidClient(),
			context.puzzlehunt
		);

		await interaction.editReply(
			`Existing puzzlehunt data has been copied to a new fluid file with id: ${id}. ` +
				'Run /change_backing_fluid_file with this id to switch the discord server to use that file instead.'
		);

		disposer.dispose();
	},
};

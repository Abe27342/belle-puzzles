import {
	CacheType,
	ChatInputCommandInteraction,
	MessageFlags,
	SlashCommandBuilder,
} from 'discord.js';
import type { Command } from './types.js';
import type {
	PuzzlehuntContext,
	SerializedPuzzlehuntContext,
} from '../puzzlehunt-context.js';
import { HuntContextError } from '../puzzlehunt-context.js';

const ID_ARG = 'id';

export const changeBackingFluidFile: Command = {
	adminOnly: true,
	data: new SlashCommandBuilder()
		.setName('change_backing_file')
		.addStringOption((builder) =>
			builder
				.setDescription('Fluid file id')
				.setName(ID_ARG)
				.setRequired(true)
		)
		.setDescription(
			'Switches the discord server to be backed by a different file. May fix Fluid summarization issues.'
		)
		.setDefaultMemberPermissions('0'),
	async execute(
		context: PuzzlehuntContext,
		interaction: ChatInputCommandInteraction<CacheType>
	) {
		if (context.backend === 'postgres') {
			throw new HuntContextError(
				409,
				'PostgreSQL hunts cannot change backing Fluid files.'
			);
		}
		const previousFileId = context.fluidFileId;
		const contextMessage = context.huntContextMessage;
		if (!interaction.replied && !interaction.deferred) {
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		}

		if (contextMessage.channelId !== interaction.channelId) {
			await interaction.editReply({
				content: 'This command can only be run from the admin channel.',
			});
			return;
		}

		await interaction.editReply({
			content: 'Switching backing file for the discord server...',
		});
		const newContext: SerializedPuzzlehuntContext = {
			googleFolderId: context.googleFolderId,
			indexId: context.indexId,
			name: context.name,
			allPuzzlesRoleId: context.allPuzzlesRoleId,
			fluidFileId: interaction.options.getString(ID_ARG),
		};
		await contextMessage.edit(JSON.stringify(newContext));
		await contextMessage.channel.messages.fetchPinned();
		await interaction.editReply(
			`Complete! To revert this change, rerun this command using the old file id: ${previousFileId}.`
		);
	},
};

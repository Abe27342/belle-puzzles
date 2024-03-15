import {
	CacheType,
	ChatInputCommandInteraction,
	SlashCommandBuilder,
} from 'discord.js';
import { Command } from './types';
import { PuzzlehuntContext } from '../puzzlehunt-context';
import { computeAssociatedRoundOrPuzzle } from '../utils/index.js';

const NAME_ARG = 'new_name';
const URL_ARG = 'new_url';
const SHEET_ID_ARG = 'new_sheet_id';

export const edit: Command = {
	data: new SlashCommandBuilder()
		.setName('edit')
		.addSubcommand((builder) =>
			builder
				.setName('name')
				.setDescription('Change the name of a puzzle or round')
				.addStringOption((builder) =>
					builder
						.setName(NAME_ARG)
						.setDescription('New name')
						.setMinLength(1)
						.setRequired(true)
				)
		)
		.addSubcommand((builder) =>
			builder
				.setName('url')
				.setDescription('Change the URL of a puzzle or round')
				.addStringOption((builder) =>
					builder
						.setName(URL_ARG)
						.setDescription('New URL')
						.setMinLength(1)
						.setRequired(true)
				)
		)
		.addSubcommand((builder) =>
			builder
				.setName('sheet_id')
				.setDescription(
					'Change the Google Sheet ID associated with a puzzle.'
				)
				.addStringOption((builder) =>
					builder
						.setName(SHEET_ID_ARG)
						.setDescription('New Google Sheet ID')
						.setMinLength(1)
						.setRequired(true)
				)
		)
		.setDescription('Edit features of existing puzzles and rounds.'),
	async execute(
		{ puzzlehunt }: PuzzlehuntContext,
		interaction: ChatInputCommandInteraction<CacheType>
	) {
		if (!interaction.deferred) {
			await interaction.deferReply({ ephemeral: true });
		}

		const puzzleObj = await computeAssociatedRoundOrPuzzle(
			interaction.channel,
			puzzlehunt
		);
		if (!puzzleObj) {
			await interaction.editReply(
				'This command must be run from a puzzle or round channel.'
			);
			return;
		}

		const subcommand = interaction.options.getSubcommand();
		switch (subcommand) {
			case 'name':
				const newName = interaction.options.getString(NAME_ARG);
				puzzlehunt.changeName(puzzleObj, newName);
				break;
			case 'url':
				const newUrl = interaction.options.getString(URL_ARG);
				try {
					new URL(newUrl);
				} catch (err) {
					await interaction.editReply('Invalid URL.');
					return;
				}
				puzzlehunt.changeUrl(puzzleObj, newUrl);
				break;
			case 'sheet_id':
				if (puzzleObj.type !== 'puzzle') {
					await interaction.editReply(
						'This command can only be run from a puzzle channel.'
					);
					return;
				}
				const newSheetId = interaction.options.getString(SHEET_ID_ARG);
				puzzlehunt.augmentWithGoogleSheet(puzzleObj, newSheetId);
				break;
		}

		await interaction.editReply('Updated.');
	},
};

import {
	CacheType,
	ChatInputCommandInteraction,
	SlashCommandBuilder,
} from 'discord.js';
import { Command } from './types';
import { PuzzlehuntContext } from '../puzzlehunt-context';
import { computeParentRound, ROUND_ARG } from '../utils/index.js';

const NAME_ARG = 'name';
const URL_ARG = 'url';

export const addPuzzle: Command = {
	data: new SlashCommandBuilder()
		.setName('add_puzzle')
		.addStringOption((builder) =>
			builder
				.setDescription('Name of the puzzle')
				.setName(NAME_ARG)
				.setRequired(true)
		)
		.addStringOption((builder) =>
			builder
				.setDescription('URL of the puzzle')
				.setName(URL_ARG)
				.setRequired(true)
		)
		.addChannelOption((builder) =>
			builder
				.setDescription("Parent round's index channel")
				.setName(ROUND_ARG)
		)
		.setDescription(
			'Adds a puzzle as a child of this channel (or sibling, if this channel is a puzzle channel).'
		),
	async execute(
		{ puzzlehunt }: PuzzlehuntContext,
		interaction: ChatInputCommandInteraction<CacheType>
	) {
		if (!interaction.deferred) {
			await interaction.deferReply({ ephemeral: true });
		}

		const { valid, parentRound } = await computeParentRound(
			interaction,
			puzzlehunt
		);
		if (!valid) {
			return;
		}
		if (!parentRound) {
			await interaction.editReply(
				'Either run this command from a puzzle channel (to create a sibling puzzle) or specify the parent_round argument.'
			);
			return;
		}

		const name = interaction.options.getString(NAME_ARG);
		puzzlehunt.addPuzzle(
			name,
			interaction.options.getString(URL_ARG),
			parentRound
		);

		await interaction.editReply(`Puzzle "${name}" added.`);
	},
};

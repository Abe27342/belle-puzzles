import {
	CacheType,
	ChatInputCommandInteraction,
	SlashCommandBuilder,
} from 'discord.js';
import { Command } from './types';
import { PuzzlehuntContext } from '../types';
import { computeParentRound, ROUND_ARG } from './utils.js';

const NAME_ARG = 'name';
const URL_ARG = 'url';

export const addRound: Command = {
	data: new SlashCommandBuilder()
		.setName('add_round')
		.addStringOption((builder) =>
			builder
				.setDescription('Name of the round')
				.setName(NAME_ARG)
				.setRequired(true)
		)
		.addStringOption((builder) =>
			builder
				.setDescription('URL of the round')
				.setName(URL_ARG)
				.setRequired(true)
		)
		.addStringOption((builder) =>
			builder
				.setDescription("Parent round's index channel")
				.setName(ROUND_ARG)
		)
		.setDescription('Adds a round as a child of this round channel.'),
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

		const name = interaction.options.getString(NAME_ARG);
		puzzlehunt.addRound(
			name,
			interaction.options.getString(URL_ARG),
			parentRound
		);

		await interaction.editReply(`Round "${name}" added.`);
	},
};

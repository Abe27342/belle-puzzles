import {
	CategoryChannel,
	EmbedBuilder,
	TextBasedChannel,
	ActionRowBuilder,
	SelectMenuBuilder,
	ButtonBuilder,
	ButtonStyle,
	ChatInputCommandInteraction,
	CacheType,
} from 'discord.js';
import { IPuzzlehunt, Puzzle, Round } from '@belle-puzzles/puzzlehunt-model';
import '../register-env/index.js';

export function generatePuzzleEmbed(puzzle: Puzzle): EmbedContent {
	const embed = new EmbedBuilder().setTitle(puzzle.name).addFields({
		name: 'Puzzle Page',
		value: `[Link](${puzzle.url})`,
		inline: true,
	});
	if (puzzle.sheetId) {
		embed.addFields({
			name: 'Spreadsheet',
			value: `[Link](https://docs.google.com/spreadsheets/d/${puzzle.sheetId})`,
			inline: true,
		});
	}
	if (puzzle.answer) {
		embed.addFields({ name: 'Answer', value: puzzle.answer, inline: true });
	}
	return { embeds: [embed] };
}

// Note: can be used directly in a message.
export interface EmbedContent {
	embeds: EmbedBuilder[];
	components?: ActionRowBuilder<SelectMenuBuilder | ButtonBuilder>[];
}

export function generateRoundEmbed(
	round: Round,
	puzzlehunt: IPuzzlehunt
): EmbedContent {
	const puzzles = Array.from(puzzlehunt.puzzles).filter(
		(puzzle) =>
			puzzle.roundId === round.id && puzzle.discordInfo !== undefined
	);
	const embed = new EmbedBuilder().setTitle('List of Puzzles').setDescription(
		[
			'You may select which puzzle channels to join using the drop-down menu below.',
			'',
			// TODO: Paginate past puzzle limit, since that was an issue last hunt
			...puzzles.map(
				(puzzle) =>
					`**${puzzle.name}** | [Puzzle Link](${puzzle.url}) | ${
						puzzle.sheetId
							? `[Spreadsheet](https://docs.google.com/spreadsheets/d/${puzzle.sheetId})`
							: 'No spreadsheet'
					} | <#${puzzle.discordInfo.channelId}>${
						puzzle.answer === undefined
							? ''
							: ` | SOLVED: ${puzzle.answer}`
					}`
			),
		].join('\n')
	);
	if (round.roundId) {
		embed.addFields({
			name: 'Parent Round',
			value: `<#${
				puzzlehunt.getRound(round.roundId).discordInfo.indexChannelId
			}>`,
		});
	}
	const rows: ActionRowBuilder<SelectMenuBuilder | ButtonBuilder>[] = [];
	if (puzzles.length > 0) {
		const options = puzzles.map((puzzle) => ({
			label: puzzle.name,
			value: `${puzzle.id}`,
		}));
		const makeVisibleRow =
			new ActionRowBuilder<SelectMenuBuilder>().addComponents(
				new SelectMenuBuilder()
					.setCustomId('makePuzzleVisible')
					.setPlaceholder('Select which puzzle channels to join')
					.setOptions(options)
					.setMinValues(0)
					.setMaxValues(puzzles.length)
			);
		const makeInvisibleRow =
			new ActionRowBuilder<SelectMenuBuilder>().addComponents(
				new SelectMenuBuilder()
					.setCustomId('makePuzzleInvisible')
					.setPlaceholder('Select which puzzle channels to leave')
					.setOptions(options)
					.setMinValues(0)
					.setMaxValues(puzzles.length)
			);
		rows.push(makeVisibleRow, makeInvisibleRow);
	}
	const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId('toggleRound')
			.setLabel('Toggle see all puzzle channels for this round')
			.setStyle(ButtonStyle.Secondary),
		new ButtonBuilder()
			.setCustomId('toggleAll')
			.setLabel('Toggle see all puzzle channels for the entire hunt')
			.setStyle(ButtonStyle.Secondary)
	);
	rows.push(buttonRow);
	return { embeds: [embed], components: rows };
}

export function computeAssociatedRoundOrPuzzle(
	channel: TextBasedChannel | CategoryChannel,
	puzzlehunt: IPuzzlehunt
): Round | Puzzle | undefined {
	for (const round of puzzlehunt.rounds) {
		const { discordInfo } = round;
		if (
			discordInfo?.channelId === channel.id ||
			discordInfo?.indexChannelId === channel.id
		) {
			return round;
		}
	}

	for (const puzzle of puzzlehunt.puzzles) {
		const { discordInfo } = puzzle;
		if (discordInfo?.channelId === channel.id) {
			return puzzle;
		}
	}

	return undefined;
}

export const ROUND_ARG = 'parent_round';

export async function computeParentRound(
	interaction: ChatInputCommandInteraction<CacheType>,
	puzzlehunt: IPuzzlehunt
): Promise<{ valid: boolean; parentRound?: Round }> {
	const puzzleObj = computeAssociatedRoundOrPuzzle(
		interaction.channel,
		puzzlehunt
	);
	let parentRound: Round;
	const parentRoundArg = interaction.options.getString(ROUND_ARG);
	if (parentRoundArg) {
		const match = parentRoundArg.match(/^<#(\d*)>$/);
		if (!match) {
			await interaction.editReply(
				'parentRound should be a discord channel.'
			);
			return { valid: false };
		}
		const [, indexChannelId] = match;
		parentRound = Array.from(puzzlehunt.rounds).find(
			(round) => round.discordInfo?.indexChannelId === indexChannelId
		);
		if (!parentRound) {
			await interaction.editReply(
				'parentRound should be one of the round index channels.'
			);
			return { valid: false };
		}
	} else {
		parentRound =
			puzzleObj?.type === 'puzzle'
				? puzzlehunt.getRound(puzzleObj.roundId)
				: puzzleObj;
	}
	return { valid: true, parentRound };
}

export const BELLE_USER_ID = process.env.CLIENT_ID;

export function assert(condition: boolean, message: string): asserts condition {
	if (!condition) {
		throw new Error(`Assertion failed: ${message}`);
	}
}

// inclusive
export function getAncestorRounds(
	puzzlehunt: IPuzzlehunt,
	puzzleObj: Puzzle | Round
): (Round | Puzzle)[] {
	const ancestorRounds = [];
	for (
		let ancestorRound = puzzleObj;
		ancestorRound !== undefined;
		ancestorRound =
			ancestorRound.roundId !== undefined
				? puzzlehunt.getRound(ancestorRound.roundId)
				: undefined
	) {
		ancestorRounds.push(ancestorRound);
	}
	return ancestorRounds;
}

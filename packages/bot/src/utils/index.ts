import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	CacheType,
	CategoryChannel,
	ChatInputCommandInteraction,
	Collection,
	EmbedBuilder,
	Guild,
	Interaction,
	Message,
	MessageManager,
	SelectMenuBuilder,
	TextBasedChannel,
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
	if (puzzle.status) {
		embed.addFields({ name: 'Status', value: puzzle.status, inline: true });
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

	const descriptionLines = [
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
	];

	let description = descriptionLines.join('\n');
	if (description.length > 4096) {
		description =
			'**Warning: max embed size reached, some data is not displayed. Consider reorganizing this round into sub-rounds.**\n';
		for (
			let i = 0;
			description.length + descriptionLines[i].length + 1 <= 4096;
			i++
		) {
			description += `${descriptionLines[i]}\n`;
		}
	}

	const embed = new EmbedBuilder()
		.setTitle('List of Puzzles')
		.setDescription(description);
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

export function* descendantPuzzles(round: Round): Iterable<Puzzle> {
	for (const child of round.children) {
		switch (child.type) {
			case 'puzzle':
				yield child;
				break;
			case 'round':
				yield* descendantPuzzles(child);
				break;
		}
	}
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
	const parentRoundArg = interaction.options.getChannel(ROUND_ARG);
	if (parentRoundArg) {
		const indexChannelId = parentRoundArg.id;
		parentRound = Array.from(puzzlehunt.rounds).find(
			(round) =>
				round.discordInfo?.indexChannelId === indexChannelId ||
				round.discordInfo?.channelId === indexChannelId
		);
		if (!parentRound) {
			await interaction.editReply(
				'parent_round should be one of the round channels.'
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

const PUZZLE_ADMIN_CHANNEL = 'belle-bot-admin';

export async function getHuntContextMessage(
	guild: Guild,
	interaction?: Interaction
): Promise<Message<true> | undefined> {
	const metadataChannels = guild.channels.cache.filter(
		(value) => value.name === PUZZLE_ADMIN_CHANNEL && value.isTextBased()
	) as Collection<string, TextBasedChannel>;
	if (metadataChannels.size === 0) {
		if (interaction?.isRepliable()) {
			await interaction.reply(
				'No puzzle hunt was found on this server. Create one with "/create".'
			);
		}
		return;
	}
	if (metadataChannels.size > 1) {
		if (interaction?.isRepliable()) {
			await interaction.reply(
				`Multiple candidate admin channels were found. Please delete any excess channels named "${PUZZLE_ADMIN_CHANNEL}.`
			);
		}
		return;
	}
	const channel = metadataChannels.first();
	const getAdminMessage = () =>
		// cast is necessary due to bad typescript expansion of boolean type.
		(channel.messages as MessageManager<true>).cache.find(
			(message) =>
				message.author.id === process.env.CLIENT_ID && message.pinned
		);
	let adminMessage = getAdminMessage();
	if (!adminMessage) {
		await Promise.all([
			interaction?.isRepliable()
				? interaction.deferReply({ ephemeral: true })
				: Promise.resolve(),
			channel.messages.fetchPinned(),
		]);
		adminMessage = getAdminMessage();
	}
	return adminMessage;
}

import {
	CacheType,
	CategoryChannel,
	ChannelType,
	ChatInputCommandInteraction,
	SlashCommandBuilder,
} from 'discord.js';
import { Command } from './types';
import { PuzzlehuntContext } from '../puzzlehunt-context';
import {
	computeAssociatedRoundOrPuzzle,
	descendantPuzzles,
} from '../utils/index.js';
import {
	getByDataFilter,
	updateSheet,
	updateSheetValues,
} from '../integrations/google.js';

const ROUND_ARG = 'round';

export const populateAnswers: Command = {
	data: new SlashCommandBuilder()
		.setName('populate_answers')
		.addChannelOption((builder) =>
			builder
				.setDescription('Round to add answers from')
				.addChannelTypes(ChannelType.GuildCategory)
				.setName(ROUND_ARG)
				.setRequired(true)
		)
		.setDescription(
			"Adds links and answers to all puzzles from a round to this puzzle's google sheet. Useful for metas."
		),
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
		if (!puzzleObj || puzzleObj.type === 'round') {
			await interaction.editReply(
				'This command must be run from a puzzle channel.'
			);
			return;
		}

		const { sheetId } = puzzleObj;
		if (!sheetId) {
			await interaction.editReply(
				"Please wait for this puzzle's sheet to be created and retry."
			);
			return;
		}

		const roundArg = interaction.options.getChannel(
			ROUND_ARG
		) as CategoryChannel;
		const roundToPopulateAnswersFrom = computeAssociatedRoundOrPuzzle(
			roundArg,
			puzzlehunt
		);

		if (
			!roundToPopulateAnswersFrom ||
			roundToPopulateAnswersFrom.type !== 'round'
		) {
			await interaction.editReply(
				'Unable to find puzzle round associated with this category. Please select a different one.'
			);
			return;
		}

		const values: [string, string, string][] = [
			['Title', 'Answer', 'Google sheet'],
		];
		for (const puzzle of descendantPuzzles(roundToPopulateAnswersFrom)) {
			values.push([
				`=hyperlink("${puzzle.url}", "${puzzle.name}")`,
				puzzle.answer,
				`=hyperlink("https://docs.google.com/spreadsheets/d/${puzzle.sheetId}","Link")`,
			]);
		}

		const feederSheetName = `${roundToPopulateAnswersFrom.name} Feeder Answers`;
		// This whole pattern is pretty awkward, but haven't found docs on expectations for what sheets APIs
		// do when ranges don't exist or recommended ways to check for existence.
		// Being a bit paranoid here with safety checks as overwriting data would be pretty annoying.
		const spreadsheet = await getByDataFilter({
			spreadsheetId: sheetId,
		});

		const existingFeederSheet = spreadsheet.sheets.find(
			(sheet) => sheet.properties.title === feederSheetName
		);
		let feederSheetId: number;
		if (existingFeederSheet !== undefined) {
			const spreadsheetWithData = await getByDataFilter({
				spreadsheetId: sheetId,
				requestBody: {
					dataFilters: [
						{
							a1Range: `${feederSheetName}!A1:C1`,
						},
					],
					includeGridData: true,
				},
			});
			const existingFeederSheetWithData = spreadsheetWithData.sheets.find(
				(sheet) => sheet.properties.title === feederSheetName
			);

			const sheetData = existingFeederSheetWithData.data[0].rowData;
			// Extra null checks here handle spreadsheet without values in A1:C1
			const headerValues = (sheetData?.[0].values ?? []).map(
				(value) => value?.userEnteredValue?.stringValue
			);
			if (
				headerValues[0] !== 'Title' ||
				headerValues[1] !== 'Answer' ||
				headerValues[2] !== 'Google sheet'
			) {
				await interaction.editReply(
					`This puzzle's spreadsheet already has a tab named '[${feederSheetName}](https://docs.google.com/spreadsheets/d/${sheetId}/edit?gid=${feederSheetId})' which doesn't match the bot's generated headers.` +
						`Please re-run this command after renaming that tab to avoid having any of its data overwritten.`
				);
				return;
			}
			feederSheetId = existingFeederSheet.properties.sheetId;
		} else {
			const data = await updateSheet({
				spreadsheetId: sheetId,
				requestBody: {
					requests: [
						{
							addSheet: {
								properties: {
									title: feederSheetName,
								},
							},
						},
					],
				},
			});

			feederSheetId = data.replies[0].addSheet.properties.sheetId;

			await updateSheet({
				spreadsheetId: sheetId,
				requestBody: {
					requests: [
						{
							repeatCell: {
								// Unispace font for puzzle title / answers
								cell: {
									userEnteredFormat: {
										textFormat: {
											fontFamily: 'Source Code Pro',
										},
									},
								},
								fields: '*',
								range: {
									startColumnIndex: 0,
									endColumnIndex: 2,
									startRowIndex: 1,
									sheetId: feederSheetId,
								},
							},
						},
						{
							// Bold headers
							repeatCell: {
								cell: {
									userEnteredFormat: {
										textFormat: {
											bold: true,
										},
									},
								},
								fields: '*',
								range: {
									startColumnIndex: 0,
									endColumnIndex: 3,
									startRowIndex: 0,
									endRowIndex: 1,
									sheetId: feederSheetId,
								},
							},
						},
					],
				},
			});
		}

		await updateSheetValues({
			spreadsheetId: sheetId,
			requestBody: {
				data: [{ range: `${feederSheetName}!A1:C`, values }],
				valueInputOption: 'USER_ENTERED',
			},
		});

		await interaction.editReply(
			`Answers populated on the [${feederSheetName}](https://docs.google.com/spreadsheets/d/${sheetId}/edit?gid=${feederSheetId}) tab.`
		);
	},
};

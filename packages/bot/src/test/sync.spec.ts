import { describe, it, beforeAll, afterEach, expect, vi } from 'vitest';
import { ChannelType } from 'discord.js';
import { BelleBotClient, createClient } from '../client';
import {
	IPuzzlehuntProvider,
	createPuzzlehuntProvider,
} from '../puzzlehunt-provider';
import { IServerState, MockDiscord } from './mockDiscord';
import { loadPuzzlehunt, runCommand } from './testUtils';
import {
	IPuzzlehunt,
	loadExistingPuzzlehunt,
} from '@belle-puzzles/puzzlehunt-model';
import { makeFluidClient } from '../fluid/client';
import { getHuntContext } from '../puzzlehunt-context';
vi.mock('../integrations/google.js');

// This file tests various aspects of the bot's synchronization of the discord server with the fluid file.
// These flows are important for ensuring that the bot is able to handle web users making changes to the backing file.
// Testing some of these things by editing the fluid file directly and not going through a bot command can also be
// more natural, so we do that here.

function useSimplePuzzlehuntProvider(): IPuzzlehuntProvider {
	const disposers: { dispose: () => void }[] = [];

	afterEach(() => {
		for (const disposer of disposers) {
			disposer.dispose();
		}
		disposers.length = 0;
	});
	return {
		getPuzzlehunt: async (id) => {
			const { puzzlehunt, disposer } = await loadExistingPuzzlehunt(
				makeFluidClient(),
				id
			);
			disposers.push(disposer);
			return puzzlehunt;
		},
	};
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

const channelRef = (id: string | number): string => `<#${id}>`;

describe('Sync', () => {
	const asyncErrors: any[] = [];
	let botPuzzlehuntProvider: IPuzzlehuntProvider;
	let mockDiscord: MockDiscord;
	let serverState: IServerState;
	let client: BelleBotClient;
	const webPuzzlehuntProvider = useSimplePuzzlehuntProvider();
	let botPuzzlehunt, webPuzzlehunt: IPuzzlehunt;

	const initializePuzzlehunt = async () => {
		botPuzzlehuntProvider = createPuzzlehuntProvider();
		mockDiscord = new MockDiscord();
		serverState = mockDiscord.serverState;
		client = createClient({
			token: 'mock-token',
			puzzlehuntProvider: botPuzzlehuntProvider,
			baseClient: mockDiscord.getClient(),
			onError: async (error) => {
				asyncErrors.push({ error, stack: error.stack });
			},
		});
		await runCommand(
			'/create name: test-hunt folder_link: https://drive.google.com/drive/folders/mock-folder-id?usp=sharing',
			client,
			mockDiscord
		);

		webPuzzlehunt = await loadPuzzlehunt(
			webPuzzlehuntProvider,
			mockDiscord
		);
		// This is necessary as it's the catalyst for the bot subscribing to change events.
		// The architecture here could use some improvement, but it's how it works for now (and this function
		// is called sufficiently often whenever users might be acting on the document)
		await getHuntContext(
			client,
			mockDiscord.getClient().guilds.cache.at(0)
		);

		const round1 = webPuzzlehunt.addRound('round 1', 'mock-round-url-1');
		webPuzzlehunt.addPuzzles(
			[
				{ name: 'puzzle 1', url: 'puzzle-1-url' },
				{ name: 'puzzle 2', url: 'puzzle-2-url' },
				{ name: 'puzzle 3', url: 'puzzle-3-url' },
			],
			round1
		);
		const puzzles = Array.from(webPuzzlehunt.puzzles);
		webPuzzlehunt.solve(
			puzzles.find((puzzle) => puzzle.name === 'puzzle 1').id,
			'foo'
		);
		webPuzzlehunt.solve(
			puzzles.find((puzzle) => puzzle.name === 'puzzle 3').id,
			'bar'
		);
		const round1d1 = webPuzzlehunt.addRound(
			'round 1d1',
			'mock-round-url-1d1',
			round1
		);
		webPuzzlehunt.addRound('round 1d2', 'mock-round-url-1d1', round1);
		webPuzzlehunt.addPuzzle('puzzle 1d1d1', 'puzzle-1d1d1-url', round1d1);
		/**
		 * Set up:
		 * round 1
		 * - puzzle 1: foo
		 * - puzzle 2
		 * - puzzle 3: bar
		 * - round 1d1
		 *   - puzzle 1d1d1
		 * - round 1d2
		 */
		let puzzle111Exists = false;
		while (!puzzle111Exists) {
			// If something goes wrong while the bot processes async work, this will make us fail earlier
			// rather than timeout and report in the afterEach.
			expect(asyncErrors).toEqual([]);
			await client.ensurePendingWorkProcessed();
			// Ensure event loop has time to process more than the microtask queue.
			await delay(0);
			puzzle111Exists =
				serverState.channels.filter(
					(channel) => channel.name === 'puzzle-1d1d1'
				).length > 0;
		}
	};

	afterEach(() => {
		vi.resetAllMocks();
		expect(asyncErrors).toEqual([]);
		asyncErrors.length = 0;
	});

	// Rather set up the same scenario repeatedly, we do it once and then run a bunch of verification that
	// the server ends up in a reasonable state.
	beforeAll(initializePuzzlehunt);

	describe('creates appropriate channels', () => {
		it.each([
			'solved-puzzle-1',
			'puzzle-2',
			'solved-puzzle-3',
			'puzzle-1d1d1',
		])('for puzzle "%i"', (name) => {
			const channel = serverState.channels.find(
				(channel) => channel.name === name
			);

			expect(channel).toBeDefined();
			expect(channel.type).toBe(ChannelType.GuildText);
		});

		it.each(['round-1', 'round-1d1', 'round-1d2'])(
			'for puzzle index for round "%i"',
			(roundName) => {
				const channel = serverState.channels.find(
					(channel) => channel.name === `${roundName}-puzzles`
				);
				expect(channel).toBeDefined();
				expect(channel.type).toBe(ChannelType.GuildText);
			}
		);

		it.each(['round-1', 'round-1d1', 'round-1d2'])(
			'for category for round "%i"',
			(roundName) => {
				// TODO: Verify that child puzzles are in the right category--requires increasing mock fidelity to track
				// that info in the REST API.
				const channel = serverState.channels.find(
					(channel) => channel.name === roundName
				);
				expect(channel).toBeDefined();

				expect(channel.type).toBe(ChannelType.GuildCategory);
			}
		);
	});

	// Assert that embeds for the above scenario are all in a reasonable state after executing
	// all synchronization.
	describe('updates embeds', () => {
		it('on round add', () => {
			const round1d2Channel = serverState.findChannelBy(
				'name',
				'round-1d2-puzzles'
			);
			const messages = serverState.messages.get(round1d2Channel.id);
			expect(messages.length).toBe(1);
			expect(messages[0].content).toBeUndefined();
			expect(messages[0].embeds).toMatchObject([
				{
					description:
						'You may select which puzzle channels to join using the drop-down menu below.\n',
					title: 'List of Puzzles',
				},
			]);
		});

		describe('on puzzle add', () => {
			it('for the puzzle channel', () => {
				const puzzleChannel = serverState.findChannelBy(
					'name',
					'puzzle-1d1d1'
				);
				const messages = serverState.messages.get(puzzleChannel.id);
				expect(messages.length).toBe(1);
				expect(messages[0].content).toBeUndefined();
				expect(messages[0].embeds).toMatchObject([
					{
						title: 'puzzle 1d1d1',
						fields: [
							{
								name: 'Puzzle Page',
								value: '[Link](puzzle-1d1d1-url)',
							},
							{
								name: 'Spreadsheet',
								value: '[Link](https://docs.google.com/spreadsheets/d/mock-google-sheet-id)',
								inline: true,
							},
						],
					},
				]);
			});

			it('for the round channel', () => {
				const round1d2Channel = serverState.findChannelBy(
					'name',
					'round-1d1-puzzles'
				);
				const messages = serverState.messages.get(round1d2Channel.id);
				expect(messages.length).toBe(1);
				expect(messages[0].content).toBeUndefined();
				expect(messages[0].embeds).toMatchObject([
					{
						description: `You may select which puzzle channels to join using the drop-down menu below.

**puzzle 1d1d1** | [Puzzle Link](puzzle-1d1d1-url) | [Spreadsheet](https://docs.google.com/spreadsheets/d/mock-google-sheet-id) | ${channelRef(
							serverState.findChannelBy('name', 'puzzle-1d1d1').id
						)}`,
						title: 'List of Puzzles',
						fields: [
							{
								name: 'Parent Round',
								value: channelRef(
									serverState.findChannelBy(
										'name',
										'round-1-puzzles'
									).id
								),
							},
						],
					},
				]);
			});
		});

		it('on puzzle solve', () => {
			const puzzleChannel = serverState.findChannelBy(
				'name',
				'solved-puzzle-1'
			);
			const messages = serverState.messages.get(puzzleChannel.id);
			expect(messages.length).toBe(1);
			expect(messages[0].content).toBeUndefined();
			expect(messages[0].embeds).toMatchObject([
				{
					title: 'puzzle 1',
					fields: [
						{
							name: 'Puzzle Page',
							value: '[Link](puzzle-1-url)',
						},
						{
							name: 'Spreadsheet',
							value: '[Link](https://docs.google.com/spreadsheets/d/mock-google-sheet-id)',
							inline: true,
						},
						{
							name: 'Answer',
							value: 'foo',
							inline: true,
						},
					],
				},
			]);
		});

		it('with several puzzles in the root round', () => {
			const round1Channel = serverState.findChannelBy(
				'name',
				'round-1-puzzles'
			);
			const messages = serverState.messages.get(round1Channel.id);
			expect(messages.length).toBe(1);
			expect(messages[0].content).toBeUndefined();
			expect(messages[0].embeds).toMatchObject([
				{
					description: `You may select which puzzle channels to join using the drop-down menu below.

**puzzle 1** | [Puzzle Link](puzzle-1-url) | [Spreadsheet](https://docs.google.com/spreadsheets/d/mock-google-sheet-id) | ${channelRef(
						serverState.findChannelBy('name', 'solved-puzzle-1').id
					)} | SOLVED: foo
**puzzle 2** | [Puzzle Link](puzzle-2-url) | [Spreadsheet](https://docs.google.com/spreadsheets/d/mock-google-sheet-id) | ${channelRef(
						serverState.findChannelBy('name', 'puzzle-2').id
					)}
**puzzle 3** | [Puzzle Link](puzzle-3-url) | [Spreadsheet](https://docs.google.com/spreadsheets/d/mock-google-sheet-id) | ${channelRef(
						serverState.findChannelBy('name', 'solved-puzzle-3').id
					)} | SOLVED: bar`,
					title: 'List of Puzzles',
				},
			]);
		});
	});

	describe.skip('updates permissions', () => {
		// TODO: Test permissions for puzzles and rounds. This requires increasing mock fidelity.
	});
});

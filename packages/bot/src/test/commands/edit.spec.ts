import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import { BelleBotClient, createClient } from '../../client';
import {
	IPuzzlehuntProvider,
	createPuzzlehuntProvider,
} from '../../puzzlehunt-provider';
import { ChannelData, IServerState, MockDiscord } from '../mockDiscord';
import { loadPuzzlehunt, runCommand, runCommands } from '../testUtils';
vi.mock('../../integrations/google.js');

describe('edit', () => {
	const asyncErrors: any[] = [];
	const getPuzzlehunt = () => loadPuzzlehunt(puzzlehuntProvider, mockDiscord);
	let puzzlehuntProvider: IPuzzlehuntProvider;
	let mockDiscord: MockDiscord;
	let serverState: IServerState;
	let client: BelleBotClient;
	let puzzleChannel: ChannelData;

	const initializePuzzlehunt = async () => {
		puzzlehuntProvider = createPuzzlehuntProvider();
		mockDiscord = new MockDiscord();
		serverState = mockDiscord.serverState;
		client = createClient({
			token: 'mock-token',
			puzzlehuntProvider,
			baseClient: mockDiscord.getClient(),
			onError: async (error) => {
				asyncErrors.push({ error, stack: error.stack });
			},
		});
		await runCommands(client, mockDiscord, [
			'/create name: test-hunt folder_link: https://drive.google.com/drive/folders/mock-folder-id?usp=sharing',
			'/add_round name: round 1 url: mock-url',
		]);
		const round1IndexId = serverState.findChannelBy(
			'name',
			'round-1-puzzles'
		)?.id;
		expect(round1IndexId).toBeDefined();
		await runCommand(
			`/add_puzzle name: puzzle 1 url: mock-puzzle-url parent_round: <#${round1IndexId}>`,
			client,
			mockDiscord
		);
		puzzleChannel = serverState.findChannelBy('name', 'puzzle-1');
	};

	beforeEach(initializePuzzlehunt);

	afterEach(() => {
		vi.resetAllMocks();
		expect(asyncErrors).toEqual([]);
		asyncErrors.length = 0;
	});

	describe('supports editing name', () => {
		it('of a puzzle', async () => {
			const interaction = await runCommand(
				'/edit name new_name: new name',
				client,
				mockDiscord,
				puzzleChannel
			);
			expect(interaction.editReply).toHaveBeenCalledWith('Updated.');
			const puzzlehunt = await getPuzzlehunt();
			const puzzle = Array.from(puzzlehunt.puzzles)[0];
			expect(puzzle.name).toEqual('new name');
		});

		it('of a round', async () => {
			const interaction = await runCommand(
				'/edit name new_name: new name',
				client,
				mockDiscord,
				serverState.findChannelBy('name', 'round-1-puzzles')
			);
			expect(interaction.editReply).toHaveBeenCalledWith('Updated.');
			const puzzlehunt = await getPuzzlehunt();
			const round = Array.from(puzzlehunt.rounds)[0];
			expect(round.name).toEqual('new name');
		});
	});

	describe('supports editing URL', () => {
		it('of a puzzle', async () => {
			const interaction = await runCommand(
				'/edit url new_url: https://google.com',
				client,
				mockDiscord,
				puzzleChannel
			);
			expect(interaction.editReply).toHaveBeenCalledWith('Updated.');
			const puzzlehunt = await getPuzzlehunt();
			const puzzle = Array.from(puzzlehunt.puzzles)[0];
			expect(puzzle.url).toEqual('https://google.com');
		});

		it('of a round', async () => {
			const interaction = await runCommand(
				'/edit url new_url: https://google.com',
				client,
				mockDiscord,
				serverState.findChannelBy('name', 'round-1-puzzles')
			);
			expect(interaction.editReply).toHaveBeenCalledWith('Updated.');
			const puzzlehunt = await getPuzzlehunt();
			const round = Array.from(puzzlehunt.rounds)[0];
			expect(round.url).toEqual('https://google.com');
		});
	});

	describe('supports editing sheet ID', () => {
		it('of a puzzle', async () => {
			const interaction = await runCommand(
				'/edit sheet_id new_sheet_id: mock-sheet-id-2',
				client,
				mockDiscord,
				puzzleChannel
			);
			expect(interaction.editReply).toHaveBeenCalledWith('Updated.');
			const puzzlehunt = await getPuzzlehunt();
			const puzzle = Array.from(puzzlehunt.puzzles)[0];
			expect(puzzle.sheetId).toEqual('mock-sheet-id-2');
		});
	});
});

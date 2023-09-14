import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import { BelleBotClient, createClient } from '../../client';
import {
	IPuzzlehuntProvider,
	createPuzzlehuntProvider,
} from '../../puzzlehunt-provider';
import { ChannelData, IServerState, MockDiscord } from '../mockDiscord';
import { loadPuzzlehunt, runCommand, runCommands } from '../testUtils';
vi.mock('../../integrations/google.js');

describe('update_status', () => {
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

	it('can update the status of a puzzle', async () => {
		const interaction = await runCommand(
			'/update_status status: very stuck',
			client,
			mockDiscord,
			puzzleChannel
		);
		expect(interaction.editReply).toHaveBeenCalledWith(
			'Puzzle status updated.'
		);
		const puzzlehunt = await getPuzzlehunt();
		const puzzle = Array.from(puzzlehunt.puzzles)[0];
		expect(puzzle.status).toEqual('very stuck');
		expect(puzzle.lastStatusUpdate).toBeTypeOf('number');
	});

	it('can clear the status of a puzzle', async () => {
		await runCommand(
			'/update_status status: very stuck',
			client,
			mockDiscord,
			puzzleChannel
		);
		await runCommand('/update_status', client, mockDiscord, puzzleChannel);
		const puzzlehunt = await getPuzzlehunt();
		expect(Array.from(puzzlehunt.puzzles)[0].status).toBeUndefined();

		const updateMessages = serverState.messages
			.get(serverState.findChannelBy('name', 'puzzle-updates').id)
			.map((message) => message.content)
			.filter((content) => content.includes('puzzle 1'));
		expect(updateMessages).toEqual([
			'Status updated for puzzle 1: "very stuck".',
			'Status cleared for puzzle 1.',
		]);
	});

	it('gives a reasonable error when run from a non-puzzle channel', async () => {
		const interaction = await runCommand(
			'/update_status status: very stuck',
			client,
			mockDiscord,
			serverState.findChannelBy('name', 'belle-bot-admin')
		);
		expect(interaction.editReply).toHaveBeenCalledWith(
			'No puzzle is associated with this channel!'
		);
	});
});

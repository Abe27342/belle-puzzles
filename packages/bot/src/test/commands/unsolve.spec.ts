import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import { BelleBotClient, createClient } from '../../client';
import {
	IPuzzlehuntProvider,
	createPuzzlehuntProvider,
} from '../../puzzlehunt-provider';
import { ChannelData, IServerState, MockDiscord } from '../mockDiscord';
import { loadPuzzlehunt, runCommand, runCommands } from '../testUtils';
vi.mock('../../integrations/google.js');

describe('unsolve', () => {
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
		await runCommand(
			'/solve answer: FOOBAR',
			client,
			mockDiscord,
			puzzleChannel
		);
	};

	afterEach(() => {
		vi.resetAllMocks();
		expect(asyncErrors).toEqual([]);
		asyncErrors.length = 0;
	});

	beforeEach(initializePuzzlehunt);

	it('can unsolve a puzzle', async () => {
		const interaction = await runCommand(
			'/unsolve',
			client,
			mockDiscord,
			puzzleChannel
		);
		expect(interaction.editReply).toHaveBeenCalledWith('Success!');
		const puzzlehunt = await getPuzzlehunt();
		const puzzles = Array.from(puzzlehunt.puzzles);
		expect(puzzles).toHaveLength(1);
		expect(puzzles[0].answer).toEqual(undefined);
	});

	it('gives a reasonable error when run from a non-puzzle channel', async () => {
		const interaction = await runCommand(
			'/unsolve',
			client,
			mockDiscord,
			serverState.findChannelBy('name', 'belle-bot-admin')
		);
		expect(interaction.editReply).toHaveBeenCalledWith(
			'No puzzle is associated with this channel!'
		);
	});
});

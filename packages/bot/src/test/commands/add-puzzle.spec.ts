import {
	describe,
	it,
	beforeAll,
	beforeEach,
	afterEach,
	expect,
	vi,
} from 'vitest';
import { BelleBotClient, createClient } from '../../client';
import {
	IPuzzlehuntProvider,
	createPuzzlehuntProvider,
} from '../../puzzlehunt-provider';
import { HasName, IServerState, MockDiscord } from '../mockDiscord';
import { loadPuzzlehunt, runCommand, runCommands } from '../testUtils';
vi.mock('../../integrations/google.js');

const toName = (obj: HasName) => obj.name;

describe('add_puzzle', () => {
	const asyncErrors: any[] = [];
	const getPuzzlehunt = () => loadPuzzlehunt(puzzlehuntProvider, mockDiscord);
	let puzzlehuntProvider: IPuzzlehuntProvider;
	let mockDiscord: MockDiscord;
	let serverState: IServerState;
	let client: BelleBotClient;

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
	};

	afterEach(() => {
		vi.resetAllMocks();
		expect(asyncErrors).toEqual([]);
		asyncErrors.length = 0;
	});

	describe('succeeds in creating a puzzle', () => {
		beforeEach(initializePuzzlehunt);

		it('when given an explicit parent round', async () => {
			const round1IndexId = serverState.findChannelBy(
				'name',
				'round-1-puzzles'
			)?.id;
			expect(round1IndexId).toBeDefined();
			const interaction = await runCommand(
				`/add_puzzle name: puzzle 1 url: mock-puzzle-url parent_round: <#${round1IndexId}>`,
				client,
				mockDiscord
			);
			expect(interaction.editReply).toHaveBeenCalledWith(
				'Puzzle "puzzle 1" added.'
			);

			const {
				serverState: { channels, roles },
			} = mockDiscord;

			expect(
				channels
					.map(toName)
					.filter((name) => name.startsWith('puzzle-1'))
			).toEqual(['puzzle-1']);
			expect(roles.map(toName)).toContain('puzzle 1');
			const puzzlehunt = await getPuzzlehunt();
			const puzzles = Array.from(puzzlehunt.puzzles);
			expect(puzzles).toHaveLength(1);
			expect(puzzlehunt.getRound(puzzles[0].roundId).name).toEqual(
				'round 1'
			);
		});

		it('when run from a sibling puzzle channel', async () => {
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
			const puzzle1Channel = serverState.findChannelBy(
				'name',
				'puzzle-1'
			);
			const interaction = await runCommand(
				`/add_puzzle name: puzzle 2 url: mock-puzzle-url-2`,
				client,
				mockDiscord,
				puzzle1Channel
			);
			expect(interaction.editReply).toHaveBeenCalledWith(
				'Puzzle "puzzle 2" added.'
			);

			const { channels, roles, messages } = serverState;

			expect(
				channels
					.map(toName)
					.filter((name) => name.startsWith('puzzle-2'))
			).toEqual(['puzzle-2']);
			expect(roles.map(toName)).toContain('puzzle 2');
			const puzzlehunt = await getPuzzlehunt();
			const puzzles = Array.from(puzzlehunt.puzzles);
			expect(puzzles).toHaveLength(2);
			expect(
				puzzlehunt.getRound(
					puzzles.find((puzzle) => puzzle.name === 'puzzle 2').roundId
				).name
			).toEqual('round 1');
			expect(
				messages
					.get(
						serverState.findChannelBy('name', 'puzzle-add-solves')
							.id
					)
					.map((message) => message.content)
			).toEqual([
				'New puzzle unlocked in round "round 1": "puzzle 1".',
				'New puzzle unlocked in round "round 1": "puzzle 2".',
			]);
		});

		it('when run from a sibling puzzle channel', async () => {
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
			const puzzle1Channel = serverState.findChannelBy(
				'name',
				'puzzle-1'
			);
			const interaction = await runCommand(
				`/add_puzzle name: puzzle 2 url: mock-puzzle-url-2`,
				client,
				mockDiscord,
				puzzle1Channel
			);
			expect(interaction.editReply).toHaveBeenCalledWith(
				'Puzzle "puzzle 2" added.'
			);

			const { channels, roles, messages } = serverState;

			expect(
				channels
					.map(toName)
					.filter((name) => name.startsWith('puzzle-2'))
			).toEqual(['puzzle-2']);
			expect(roles.map(toName)).toContain('puzzle 2');
			const puzzlehunt = await getPuzzlehunt();
			const puzzles = Array.from(puzzlehunt.puzzles);
			expect(puzzles).toHaveLength(2);
			expect(
				puzzlehunt.getRound(
					puzzles.find((puzzle) => puzzle.name === 'puzzle 2').roundId
				).name
			).toEqual('round 1');
			expect(
				messages
					.get(
						serverState.findChannelBy('name', 'puzzle-add-solves')
							.id
					)
					.map((message) => message.content)
			).toEqual([
				'New puzzle unlocked in round "round 1": "puzzle 1".',
				'New puzzle unlocked in round "round 1": "puzzle 2".',
			]);
		});
	});

	describe('reports a reasonable error', () => {
		// None of these commands should modify the state of the discord server or the puzzlehunt, so
		// a single `before` is sufficient.
		// If debugging a failure in one of these tests and that assumption isn't valid, might be better
		// to change this to beforeEach temporarly.
		beforeAll(initializePuzzlehunt);

		it('when run without a parent round in an invalid channel', async () => {
			const adminChannel = serverState.findChannelBy(
				'name',
				'belle-bot-admin'
			);
			expect(adminChannel).toBeDefined();
			const interaction = await runCommand(
				'/add_puzzle name: puzzle 1 url: mock-puzzle-url',
				client,
				mockDiscord,
				adminChannel
			);

			expect(interaction.editReply).toHaveBeenCalledWith(
				'Either run this command from a puzzle channel (to create a sibling puzzle) or specify the parent_round argument.'
			);
		});

		it('when run with a non-conformant parent round argument', async () => {
			const interaction = await runCommand(
				'/add_puzzle name: puzzle 1 url: mock-puzzle-url parent_round: 1234',
				client,
				mockDiscord
			);

			expect(interaction.editReply).toHaveBeenCalledWith(
				'parent_round should be a discord channel.'
			);
		});

		it('when run with a parent round argument pointing to an invalid channel', async () => {
			const interaction = await runCommand(
				'/add_puzzle name: puzzle 1 url: mock-puzzle-url parent_round: <#1234>',
				client,
				mockDiscord
			);

			expect(interaction.editReply).toHaveBeenCalledWith(
				'parent_round should be one of the round index channels.'
			);
		});
	});
});

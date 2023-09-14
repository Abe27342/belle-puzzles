import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import { BelleBotClient, createClient } from '../../client';
import {
	IPuzzlehuntProvider,
	createPuzzlehuntProvider,
} from '../../puzzlehunt-provider';
import { HasName, MockDiscord } from '../mockDiscord';
import { expectParentChild, loadPuzzlehunt, runCommand } from '../testUtils';
import { ChannelType } from 'discord.js';
vi.mock('../../integrations/google.js');

const toName = (obj: HasName) => obj.name;

describe('add_round', () => {
	const asyncErrors: any[] = [];
	const getPuzzlehunt = () => loadPuzzlehunt(puzzlehuntProvider, mockDiscord);
	let puzzlehuntProvider: IPuzzlehuntProvider;
	let mockDiscord: MockDiscord;
	let client: BelleBotClient;
	beforeEach(async () => {
		puzzlehuntProvider = createPuzzlehuntProvider();
		mockDiscord = new MockDiscord();
		client = createClient({
			token: 'mock-token',
			puzzlehuntProvider,
			baseClient: mockDiscord.getClient(),
			onError: async (error) => {
				asyncErrors.push({ error, stack: error.stack });
				throw error;
			},
		});
		await runCommand(
			'/create name: test-hunt folder_link: https://drive.google.com/drive/folders/mock-folder-id?usp=sharing',
			client,
			mockDiscord
		);
	});

	afterEach(() => {
		vi.resetAllMocks();
		expect(asyncErrors).toEqual([]);
		asyncErrors.length = 0;
	});

	it('can create a root round', async () => {
		const interaction = await runCommand(
			'/add_round name: round 1 url: mock-url',
			client,
			mockDiscord
		);
		expect(interaction.editReply).toHaveBeenCalledWith(
			'Round "round 1" added.'
		);

		const {
			serverState: { channels, roles },
		} = mockDiscord;

		expect(
			channels
				.map(toName)
				.filter((name) => name.startsWith('round-'))
				.sort()
		).toEqual(['round-1', 'round-1-puzzles'].sort());
		expect(
			channels.find((channel) => channel.name === 'round-1-puzzles').type
		).toEqual(ChannelType.GuildText);
		expect(
			channels.find((channel) => channel.name === 'round-1').type
		).toEqual(ChannelType.GuildCategory);
		expect(roles.map(toName)).toContain('round 1');
	});

	it('can create a round with an explicit parent round', async () => {
		await runCommand(
			'/add_round name: round 1 url: mock-url',
			client,
			mockDiscord
		);
		const round1IndexId = mockDiscord.serverState.channels.find(
			(channel) => channel.name === 'round-1-puzzles'
		)?.id;
		expect(round1IndexId).toBeDefined();
		const interaction = await runCommand(
			`/add_round name: round 2 url: mock-url-2 parent_round: <#${round1IndexId}>`,
			client,
			mockDiscord
		);
		expect(interaction.editReply).toHaveBeenCalledWith(
			'Round "round 2" added.'
		);

		const {
			serverState: { channels, roles },
		} = mockDiscord;

		expect(
			channels
				.map(toName)
				.filter((name) => name.startsWith('round-2'))
				.sort()
		).toEqual(['round-2', 'round-2-puzzles'].sort());
		expect(
			channels.find((channel) => channel.name === 'round-2-puzzles').type
		).toEqual(ChannelType.GuildText);
		expect(
			channels.find((channel) => channel.name === 'round-2').type
		).toEqual(ChannelType.GuildCategory);
		expect(roles.map(toName)).toContain('round 2');
		const puzzlehunt = await getPuzzlehunt();
		const rounds = Array.from(puzzlehunt.rounds);
		const round1 = rounds.find((round) => round.name === 'round 1');
		const round2 = rounds.find((round) => round.name === 'round 2');
		expectParentChild(round1, round2);
	});

	it('can create a round with an implicit parent round', async () => {
		await runCommand(
			'/add_round name: round 1 url: mock-url',
			client,
			mockDiscord
		);
		const round1IndexChannel = mockDiscord.serverState.channels.find(
			(channel) => channel.name === 'round-1-puzzles'
		);
		const interaction = await runCommand(
			`/add_round name: round 2 url: mock-url-2`,
			client,
			mockDiscord,
			round1IndexChannel
		);
		expect(interaction.editReply).toHaveBeenCalledWith(
			'Round "round 2" added.'
		);

		const {
			serverState: { channels, roles },
		} = mockDiscord;

		expect(
			channels
				.map(toName)
				.filter((name) => name.startsWith('round-2'))
				.sort()
		).toEqual(['round-2', 'round-2-puzzles'].sort());
		expect(
			channels.find((channel) => channel.name === 'round-2-puzzles').type
		).toEqual(ChannelType.GuildText);
		expect(
			channels.find((channel) => channel.name === 'round-2').type
		).toEqual(ChannelType.GuildCategory);
		expect(roles.map(toName)).toContain('round 2');
		const puzzlehunt = await getPuzzlehunt();
		const rounds = Array.from(puzzlehunt.rounds);
		const round1 = rounds.find((round) => round.name === 'round 1');
		const round2 = rounds.find((round) => round.name === 'round 2');
		expectParentChild(round1, round2);
	});
});

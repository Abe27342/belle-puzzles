import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import { BelleBotClient, createClient } from '../../client';
import {
	IPuzzlehuntProvider,
	createPuzzlehuntProvider,
} from '../../puzzlehunt-provider';
import { HasName, MockDiscord } from '../mockDiscord';
import { runCommand } from '../testUtils';
vi.mock('../../integrations/google.js');

const toName = (obj: HasName) => obj.name;

describe('create', () => {
	const asyncErrors: any[] = [];
	let puzzlehuntProvider: IPuzzlehuntProvider;
	let mockDiscord: MockDiscord;
	let client: BelleBotClient;
	beforeEach(() => {
		puzzlehuntProvider = createPuzzlehuntProvider();
		mockDiscord = new MockDiscord();
		client = createClient({
			token: 'mock-token',
			puzzlehuntProvider,
			baseClient: mockDiscord.getClient(),
			onError: async (error) => {
				asyncErrors.push({ error, stack: error.stack });
			},
		});
	});

	afterEach(() => {
		vi.resetAllMocks();
		expect(asyncErrors).toEqual([]);
		asyncErrors.length = 0;
	});

	it('can create a puzzlehunt', async () => {
		const interaction = await runCommand(
			'/create name: test-hunt folder_link: https://drive.google.com/drive/folders/mock-folder-id?usp=sharing',
			client,
			mockDiscord
		);
		expect(interaction.editReply).toHaveBeenCalledWith(
			'Puzzle hunt created!'
		);

		const {
			serverState: { channels, messages, roles },
		} = mockDiscord;
		expect(channels.map(toName).sort()).toEqual(
			[
				'logs',
				'puzzle-index',
				'belle-bot-admin',
				'puzzle-add-solves',
				'puzzle-updates',
			].sort()
		);
		expect(roles.map(toName).sort()).toEqual(['All Puzzles'].sort());
		const adminMessages = messages.get(
			channels.find((channel) => channel.name === 'belle-bot-admin').id
		);
		expect(adminMessages).toHaveLength(1);
		expect(adminMessages[0]).toMatchObject({
			pinned: true,
			content: expect.stringContaining(''),
		});
		const huntMetadata = JSON.parse(adminMessages[0].content);
		expect(huntMetadata).toMatchObject({
			name: 'test-hunt',
			indexId: channels.find((channel) => channel.name === 'puzzle-index')
				.id,
			fluidFileId: expect.stringContaining(''),
			googleFolderId: 'mock-folder-id',
			allPuzzlesRoleId: roles[0].id,
		});
	});

	it('avoids creating duplicate hunts', async () => {
		await runCommand(
			'/create name: test-hunt folder_link: https://drive.google.com/drive/folders/mock-folder-id?usp=sharing',
			client,
			mockDiscord
		);
		const interaction = await runCommand(
			'/create name: test-hunt2 folder_link: https://drive.google.com/drive/folders/mock-folder-id?usp=sharing',
			client,
			mockDiscord
		);
		expect(interaction.editReply).toHaveBeenCalledWith(
			expect.stringContaining(
				'Existing puzzle hunt was found on this server.'
			)
		);
	});

	it('avoids creating hunts with invalid folder links', async () => {
		const interaction = await runCommand(
			'/create name: test-hunt folder_link: https://drive.google.com/drive/folders/mock-folder-id?usp=not-a-share-link',
			client,
			mockDiscord
		);
		expect(interaction.editReply).toHaveBeenCalledWith(
			expect.stringContaining('Invalid Google Drive folder link.')
		);
	});
});

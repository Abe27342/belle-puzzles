import { describe, it, beforeAll, afterEach, expect, vi } from 'vitest';
import {
	ChannelType,
	OverwriteType,
	PermissionFlagsBits,
	PermissionsBitField,
} from 'discord.js';
import { BelleBotClient, createClient } from '../client';
import {
	IPuzzlehuntProvider,
	createPuzzlehuntProvider,
} from '../puzzlehunt-provider';
import {
	IServerState,
	MockDiscord,
	PermissionOverwriteData,
} from './mockDiscord';
import { loadPuzzlehunt, runCommand } from './testUtils';
import {
	IPuzzlehunt,
	loadExistingPuzzlehunt,
} from '@belle-puzzles/puzzlehunt-model';
import { makeFluidClient } from '../fluid/client';
import { getHuntContext } from '../puzzlehunt-context';
import { BELLE_USER_ID } from '../utils';
import { makeViewChangeHandler } from '../sync/viewChangeHandler';
import { createDiscordAssociation, resyncServerFull } from '../sync/sync.js';
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

describe('Resource provisioning', () => {
	const provider = useSimplePuzzlehuntProvider();

	async function createContext() {
		const discord = new MockDiscord();
		const client = createClient({
			token: 'mock-token',
			puzzlehuntProvider: provider,
			baseClient: discord.getClient(),
		});
		await runCommand(
			'/create name: test-hunt folder_link: https://drive.google.com/drive/folders/mock-folder-id?usp=sharing',
			client,
			discord
		);
		const guild = discord.getGuild();
		const context = await getHuntContext(client, guild);
		return { context, guild, serverState: discord.serverState };
	}

	it.each(['change batch', 'full resync'] as const)(
		'provisions rounds concurrently before puzzles during %s without modifying the captured view',
		async (operation) => {
			const { context, guild, serverState } = await createContext();
			const { puzzlehunt } = context;
			const root = puzzlehunt.addRound('Root', '');
			await createDiscordAssociation(context, guild, root);
			const before = puzzlehunt.view;
			const first = puzzlehunt.addRound('First', '', root);
			const second = puzzlehunt.addRound('Second', '', root);
			puzzlehunt.addPuzzle('First puzzle', '', first);
			puzzlehunt.addPuzzle('Second puzzle', '', second);
			const after = puzzlehunt.view;
			const saved = JSON.stringify(after);

			const createRole = guild.roles.create.bind(guild.roles);
			const createRoleSpy = vi.spyOn(guild.roles, 'create');
			createRoleSpy.mockImplementationOnce(async (options) => {
				await Promise.resolve();
				expect(createRoleSpy).toHaveBeenNthCalledWith(
					2,
					expect.objectContaining({ name: 'Second' })
				);
				return createRole(options);
			});
			try {
				if (operation === 'change batch') {
					await makeViewChangeHandler(
						context,
						() => guild
					)({
						before,
						after,
						changes: [
							...after.rounds.slice(1),
							...after.puzzles,
						].map((node) => ({
							type: 'node-added',
							node,
						})),
					});
				} else {
					await resyncServerFull(context, guild);
				}
			} finally {
				createRoleSpy.mockRestore();
			}

			const current = puzzlehunt.view;
			const rootAssociation = current.rounds[0].discord;
			for (const puzzle of current.puzzles) {
				const parentAssociation = current.rounds.find(
					(round) => round.id === puzzle.parentId
				).discord;
				const puzzleChannel = serverState.findChannelBy(
					'id',
					puzzle.discord.channelId
				);
				expect(puzzleChannel.parent_id).toBe(
					parentAssociation.channelId
				);
				expect(
					puzzleChannel.permission_overwrites.map(
						(overwrite) => overwrite.id
					)
				).toEqual(
					expect.arrayContaining([
						rootAssociation.roleId,
						parentAssociation.roleId,
					])
				);
				expect(puzzle.sheetId).toBe('mock-google-sheet-id');
			}
			expect(JSON.stringify(after)).toBe(saved);
		}
	);

	it('uses current parent associations when an added-puzzle event contains older ones', async () => {
		const { context, guild, serverState } = await createContext();
		const { puzzlehunt } = context;
		const root = puzzlehunt.addRound('Root', '');
		await createDiscordAssociation(context, guild, root);
		const before = puzzlehunt.view;
		puzzlehunt.addPuzzle('Puzzle', '', root);
		const after = puzzlehunt.view;
		const saved = JSON.stringify(after);
		const oldAssociation = after.rounds[0].discord;
		await createDiscordAssociation(context, guild, root);
		const currentAssociation = puzzlehunt.view.rounds[0].discord;
		expect(currentAssociation.channelId).not.toBe(oldAssociation.channelId);

		await makeViewChangeHandler(
			context,
			() => guild
		)({
			before,
			after,
			changes: [{ type: 'node-added', node: after.puzzles[0] }],
		});

		const puzzle = puzzlehunt.view.puzzles[0];
		const channel = serverState.findChannelBy(
			'id',
			puzzle.discord.channelId
		);
		expect(channel.parent_id).toBe(currentAssociation.channelId);
		const permissionRoles = channel.permission_overwrites.map(
			(overwrite) => overwrite.id
		);
		expect(permissionRoles).toContain(currentAssociation.roleId);
		expect(permissionRoles).not.toContain(oldAssociation.roleId);
		expect(JSON.stringify(after)).toBe(saved);
	});

	it('uses current ancestor roles when a queued change batch contains older associations', async () => {
		const { context, guild, serverState } = await createContext();
		const { puzzlehunt } = context;
		const root = puzzlehunt.addRound('Root', '');
		await createDiscordAssociation(context, guild, root);
		const puzzle = puzzlehunt.addPuzzle('Puzzle', '', root);
		await createDiscordAssociation(context, guild, puzzle);
		const before = puzzlehunt.view;
		await createDiscordAssociation(context, guild, root);
		const after = puzzlehunt.view;
		const saved = JSON.stringify(after);
		await createDiscordAssociation(context, guild, root);
		const currentAssociation = puzzlehunt.view.rounds[0].discord;

		await makeViewChangeHandler(
			context,
			() => guild
		)({
			before,
			after,
			changes: [
				{
					type: 'node-changed',
					before: before.rounds[0],
					after: after.rounds[0],
				},
			],
		});

		const channel = serverState.findChannelBy(
			'id',
			after.puzzles[0].discord.channelId
		);
		const permissionRoles = channel.permission_overwrites.map(
			(overwrite) => overwrite.id
		);
		expect(permissionRoles).toContain(currentAssociation.roleId);
		expect(permissionRoles).not.toContain(after.rounds[0].discord.roleId);
		expect(JSON.stringify(after)).toBe(saved);
	});

	it('uses current names, children, and parent links when synchronizing a queued change batch', async () => {
		const { context, guild, serverState } = await createContext();
		const { puzzlehunt } = context;
		const root = puzzlehunt.addRound('Root', '');
		await createDiscordAssociation(context, guild, root);
		const round = puzzlehunt.addRound('Round', '', root);
		const puzzle = puzzlehunt.addPuzzle('Puzzle', '', round);
		await resyncServerFull(context, guild);
		const before = puzzlehunt.view;
		puzzlehunt.changeName(round, 'Event round');
		puzzlehunt.changeName(puzzle, 'Event puzzle');
		const after = puzzlehunt.view;
		const saved = JSON.stringify(after);
		puzzlehunt.changeName(round, 'Current round');
		puzzlehunt.changeName(puzzle, 'Current puzzle');
		puzzlehunt.updateStatus(puzzle, 'Working');
		const newerPuzzle = puzzlehunt.addPuzzle('New puzzle', '', round);
		await createDiscordAssociation(context, guild, newerPuzzle);
		await createDiscordAssociation(context, guild, root);

		await makeViewChangeHandler(
			context,
			() => guild
		)({
			before,
			after,
			changes: [
				{
					type: 'node-changed',
					before: before.rounds[1],
					after: after.rounds[1],
				},
				{
					type: 'node-changed',
					before: before.puzzles[0],
					after: after.puzzles[0],
				},
			],
		});

		const currentRound = puzzlehunt.getRound(round.id);
		const currentPuzzle = puzzlehunt.getPuzzle(puzzle.id);
		const currentRoot = puzzlehunt.getRound(root.id);
		expect(
			serverState.findChannelBy('id', currentRound.discord.channelId).name
		).toBe('current-round');
		const roundEmbed = serverState.messages.get(
			currentRound.discord.indexChannelId
		)[0].embeds[0];
		expect(roundEmbed.description).toContain('**Current puzzle**');
		expect(roundEmbed.description).toContain('**New puzzle**');
		expect(roundEmbed.description).not.toContain('Event puzzle');
		expect(roundEmbed.fields).toContainEqual({
			name: 'Parent Round',
			value: channelRef(currentRoot.discord.indexChannelId),
		});
		const puzzleEmbed = serverState.messages.get(
			currentPuzzle.discord.channelId
		)[0].embeds[0];
		expect(puzzleEmbed.title).toBe('Current puzzle');
		expect(puzzleEmbed.fields).toContainEqual({
			name: 'Status',
			value: 'Working',
			inline: true,
		});
		expect(JSON.stringify(after)).toBe(saved);
	});

	it('updates both parent indexes and permissions for equal-count exchanges', async () => {
		const { context, guild, serverState } = await createContext();
		const { puzzlehunt } = context;
		const firstRound = puzzlehunt.addRound('First round', '');
		const secondRound = puzzlehunt.addRound('Second round', '');
		const first = puzzlehunt.addPuzzle('First puzzle', '', firstRound);
		const second = puzzlehunt.addPuzzle('Second puzzle', '', secondRound);
		await resyncServerFull(context, guild);
		const before = puzzlehunt.view;
		puzzlehunt.move(first, secondRound);
		puzzlehunt.move(second, firstRound);
		const after = puzzlehunt.view;
		expect(after.rounds.map((round) => round.children.length)).toEqual(
			before.rounds.map((round) => round.children.length)
		);

		await makeViewChangeHandler(
			context,
			() => guild
		)({
			before,
			after,
			changes: before.puzzles.map((node) => ({
				type: 'node-changed',
				before: node,
				after: after.puzzles.find((puzzle) => puzzle.id === node.id),
			})),
		});

		for (const [puzzle, parent, oldParent] of [
			[
				puzzlehunt.getPuzzle(first.id),
				puzzlehunt.getRound(secondRound.id),
				puzzlehunt.getRound(firstRound.id),
			],
			[
				puzzlehunt.getPuzzle(second.id),
				puzzlehunt.getRound(firstRound.id),
				puzzlehunt.getRound(secondRound.id),
			],
		] as const) {
			const permissionRoles = serverState
				.findChannelBy('id', puzzle.discord.channelId)
				.permission_overwrites.map((overwrite) => overwrite.id);
			expect(permissionRoles).toContain(parent.discord.roleId);
			expect(permissionRoles).not.toContain(oldParent.discord.roleId);
			const parentEmbed = serverState.messages.get(
				parent.discord.indexChannelId
			)[0].embeds[0];
			expect(parentEmbed.description).toContain(`**${puzzle.name}**`);
			const oldParentEmbed = serverState.messages.get(
				oldParent.discord.indexChannelId
			)[0].embeds[0];
			expect(oldParentEmbed.description).not.toContain(
				`**${puzzle.name}**`
			);
		}
	});

	it('updates moved rounds and all descendant permissions using current ancestry', async () => {
		const { context, guild, serverState } = await createContext();
		const { puzzlehunt } = context;
		const root = puzzlehunt.addRound('Root', '');
		const destination = puzzlehunt.addRound('Destination', '');
		await resyncServerFull(context, guild);
		const moved = puzzlehunt.addRound('Moved', '', root);
		const puzzle = puzzlehunt.addPuzzle('Puzzle', '', moved);
		await resyncServerFull(context, guild);
		const before = puzzlehunt.view;
		puzzlehunt.move(moved, destination);
		const after = puzzlehunt.view;

		await makeViewChangeHandler(
			context,
			() => guild
		)({
			before,
			after,
			changes: [
				{
					type: 'node-changed',
					before: before.rounds.find(
						(round) => round.name === 'Moved'
					),
					after: after.rounds.find((round) => round.name === 'Moved'),
				},
			],
		});

		const currentMoved = puzzlehunt.getRound(moved.id);
		const currentDestination = puzzlehunt.getRound(destination.id);
		const currentRoot = puzzlehunt.getRound(root.id);
		for (const node of [currentMoved, puzzlehunt.getPuzzle(puzzle.id)]) {
			const permissionRoles = serverState
				.findChannelBy('id', node.discord.channelId)
				.permission_overwrites.map((overwrite) => overwrite.id);
			expect(permissionRoles).toContain(
				currentDestination.discord.roleId
			);
			expect(permissionRoles).not.toContain(currentRoot.discord.roleId);
		}
		expect(
			serverState.messages.get(currentMoved.discord.indexChannelId)[0]
				.embeds[0].fields
		).toContainEqual({
			name: 'Parent Round',
			value: channelRef(currentDestination.discord.indexChannelId),
		});
	});
});

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
	let webPuzzlehunt: IPuzzlehunt;

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

		// We need to wait for the bot to create associated discord channels and round-trip that back to the fluid file
		// before this is reflected in the web puzzlehunt, which is used for some of the structural checks below.
		let puzzle111DiscordExists = false;
		while (!puzzle111DiscordExists) {
			expect(asyncErrors).toEqual([]);
			await client.ensurePendingWorkProcessed();
			await delay(0);
			puzzle111DiscordExists =
				Array.from(webPuzzlehunt.puzzles).find(
					(puzzle) => puzzle.name === 'puzzle 1d1d1'
				)?.discord?.channelId !== undefined;
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
		])('for puzzle "%s"', (name) => {
			const channel = serverState.channels.find(
				(channel) => channel.name === name
			);

			expect(channel).toBeDefined();
			expect(channel.type).toBe(ChannelType.GuildText);
		});

		it.each(['round-1', 'round-1d1', 'round-1d2'])(
			'for puzzle index for round "%s"',
			(roundName) => {
				const channel = serverState.channels.find(
					(channel) => channel.name === `${roundName}-puzzles`
				);
				expect(channel).toBeDefined();
				expect(channel.type).toBe(ChannelType.GuildText);
			}
		);

		it.each(['round-1', 'round-1d1', 'round-1d2'])(
			'for category for round "%s"',
			(roundName) => {
				const channel = serverState.channels.find(
					(channel) => channel.name === roundName
				);
				expect(channel).toBeDefined();

				expect(channel.type).toBe(ChannelType.GuildCategory);
				// Additionally verify that child puzzles are in the right category channel.
				const roundObj = Array.from(webPuzzlehunt.rounds).find(
					(round) => round.discord?.channelId === channel.id
				);
				expect(roundObj).toBeDefined();
				for (const puzzle of roundObj.children) {
					if (puzzle.type === 'round') {
						continue;
					}
					const puzzleChannel = serverState.findChannelBy(
						'id',
						puzzle.discord?.channelId
					);
					expect(puzzleChannel.parent_id).toBe(channel.id);
				}
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

	describe('updates permissions', () => {
		const compareIds = (
			a: PermissionOverwriteData,
			b: PermissionOverwriteData
		) => a.id.localeCompare(b.id);

		const viewChannel = `${PermissionsBitField.Flags.ViewChannel}`;
		const sendMessages = `${PermissionsBitField.Flags.SendMessages}`;
		const none = '0';
		const allowPermissionsForRole = (name: string) => {
			expect(serverState.roles.map((role) => role.name)).toContain(name);
			const role = serverState.roles.find((role) => role.name === name);
			return {
				id: role.id,
				type: OverwriteType.Role,
				allow: viewChannel,
				deny: none,
			};
		};

		it('on a root round category channel', () => {
			const channel = serverState.findChannelBy('name', 'round-1');
			expect(
				channel.permission_overwrites?.sort(compareIds)
			).toMatchObject(
				[
					{
						id: 'guild-id',
						type: OverwriteType.Role,
						allow: none,
						deny: viewChannel,
					},
					{
						id: BELLE_USER_ID,
						type: OverwriteType.Member,
						allow: viewChannel,
						deny: none,
					},
					allowPermissionsForRole('round 1'),
					allowPermissionsForRole('All Puzzles'),
				].sort(compareIds)
			);
		});

		it('on a round index channel', () => {
			const channel = serverState.findChannelBy(
				'name',
				'round-1-puzzles'
			);

			expect(
				channel.permission_overwrites?.sort(compareIds)
			).toMatchObject(
				[
					{
						id: 'guild-id',
						type: OverwriteType.Role,
						allow: none,
						deny: sendMessages,
					},
					{
						id: BELLE_USER_ID,
						type: OverwriteType.Member,
						allow: sendMessages,
						deny: none,
					},
				].sort(compareIds)
			);
		});

		it('on a non-root round category channel', () => {
			const channel = serverState.findChannelBy('name', 'round-1d1');
			expect(
				channel.permission_overwrites?.sort(compareIds)
			).toMatchObject(
				[
					{
						id: 'guild-id',
						type: OverwriteType.Role,
						allow: none,
						deny: viewChannel,
					},
					{
						id: BELLE_USER_ID,
						type: OverwriteType.Member,
						allow: viewChannel,
						deny: none,
					},
					allowPermissionsForRole('round 1'),
					allowPermissionsForRole('round 1d1'),
					allowPermissionsForRole('All Puzzles'),
				].sort(compareIds)
			);
		});

		it('on a puzzle channel', () => {
			const channel = serverState.findChannelBy('name', 'puzzle-1d1d1');
			expect(
				channel.permission_overwrites?.sort(compareIds)
			).toMatchObject(
				[
					{
						id: 'guild-id',
						type: OverwriteType.Role,
						allow: none,
						deny: viewChannel,
					},
					{
						id: BELLE_USER_ID,
						type: OverwriteType.Member,
						allow: viewChannel,
						deny: none,
					},
					allowPermissionsForRole('round 1'),
					allowPermissionsForRole('round 1d1'),
					allowPermissionsForRole('puzzle 1d1d1'),
					allowPermissionsForRole('All Puzzles'),
				].sort(compareIds)
			);
		});
	});

	describe('historical change batches', () => {
		it('removes Discord resources for every node of a deleted subtree', async () => {
			const context = await getHuntContext(
				client,
				mockDiscord.getClient().guilds.cache.at(0)
			);
			const round = Array.from(context.puzzlehunt.rounds).find(
				(round) => round.name === 'round 1d1'
			);
			const associations = [round, ...round.children].map(
				(node) => node.discord
			);
			context.puzzlehunt.delete(round);
			await vi.waitFor(async () => {
				expect(asyncErrors).toEqual([]);
				await client.ensurePendingWorkProcessed();
				for (const association of associations) {
					expect(
						serverState.roles.some(
							(role) => role.id === association.roleId
						)
					).toBe(false);
					expect(
						serverState.channels.some(
							(channel) =>
								channel.id === association.channelId ||
								channel.id === association.indexChannelId
						)
					).toBe(false);
				}
			});
			expect(
				serverState.channels.some(
					(channel) => channel.name === 'puzzle-2'
				)
			).toBe(true);
		});
	});
});

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
	type DocumentNode,
	type PuzzlehuntView,
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
			await createDiscordAssociation(
				context,
				guild,
				puzzlehunt.view.rounds[0]
			);
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
		await createDiscordAssociation(
			context,
			guild,
			puzzlehunt.view.rounds[0]
		);
		const before = puzzlehunt.view;
		puzzlehunt.addPuzzle('Puzzle', '', root);
		const after = puzzlehunt.view;
		const saved = JSON.stringify(after);
		const oldAssociation = after.rounds[0].discord;
		await createDiscordAssociation(context, guild, after.rounds[0]);
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
		await createDiscordAssociation(
			context,
			guild,
			puzzlehunt.view.rounds[0]
		);
		puzzlehunt.addPuzzle('Puzzle', '', root);
		await createDiscordAssociation(
			context,
			guild,
			puzzlehunt.view.puzzles[0]
		);
		const before = puzzlehunt.view;
		await createDiscordAssociation(context, guild, before.rounds[0]);
		const after = puzzlehunt.view;
		const saved = JSON.stringify(after);
		await createDiscordAssociation(context, guild, after.rounds[0]);
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
				)?.discordInfo?.channelId !== undefined;
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
					(round) => round.discordInfo?.channelId === channel.id
				);
				expect(roundObj).toBeDefined();
				for (const puzzle of roundObj.children) {
					if (puzzle.type === 'round') {
						continue;
					}
					const puzzleChannel = serverState.findChannelBy(
						'id',
						puzzle.discordInfo?.channelId
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
		function replacing(
			view: PuzzlehuntView,
			replacements: DocumentNode[]
		): PuzzlehuntView {
			const byId = new Map(replacements.map((node) => [node.id, node]));
			const nodes = [...view.rounds, ...view.puzzles].map(
				(node) => byId.get(node.id) ?? node
			);
			function roundView(id: string): PuzzlehuntView['rounds'][number] {
				const round = nodes.find((node) => node.id === id);
				if (round?.type !== 'round') {
					throw new Error('Expected round in test snapshot.');
				}
				return {
					...round,
					children: nodes
						.filter((node) => node.parentId === id)
						.sort((a, b) => a.position - b.position)
						.map((node) =>
							node.type === 'round' ? roundView(node.id) : node
						),
				};
			}
			return {
				rounds: view.rounds.map((round) => roundView(round.id)),
				puzzles: nodes.filter(
					(node): node is PuzzlehuntView['puzzles'][number] =>
						node.type === 'puzzle'
				),
			};
		}

		it('updates both parent indexes and permissions for equal-count exchanges using the event view', async () => {
			const guild = mockDiscord.getClient().guilds.cache.at(0);
			const context = await getHuntContext(client, guild);
			await client.ensurePendingWorkProcessed();
			const before = context.puzzlehunt.view;
			const first = before.puzzles.find(
				(node) => node.name === 'puzzle 2'
			);
			const second = before.puzzles.find(
				(node) => node.name === 'puzzle 1d1d1'
			);
			const firstAfter = {
				...first,
				parentId: second.parentId,
				position: second.position,
			};
			const secondAfter = {
				...second,
				parentId: first.parentId,
				position: first.position,
			};
			const after = replacing(before, [firstAfter, secondAfter]);
			const handler = makeViewChangeHandler(context, () => guild);
			const changes = [
				{
					type: 'node-changed' as const,
					before: first,
					after: firstAfter,
				},
				{
					type: 'node-changed' as const,
					before: second,
					after: secondAfter,
				},
			];
			const nested = before.rounds.find(
				(round) => round.id === second.parentId
			);
			expect(
				after.rounds.find((round) => round.id === nested.id).children
			).toHaveLength(nested.children.length);
			try {
				await handler({ before, after, changes });
				expect(
					serverState
						.findChannelBy('id', first.discord.channelId)
						.permission_overwrites.map((overwrite) => overwrite.id)
				).toContain(nested.discord.roleId);
				expect(
					serverState
						.findChannelBy('id', second.discord.channelId)
						.permission_overwrites.map((overwrite) => overwrite.id)
				).not.toContain(nested.discord.roleId);
				const parentIndex = serverState.messages.get(
					nested.discord.indexChannelId
				)[0];
				expect(parentIndex.embeds[0].description).toContain(
					'**puzzle 2**'
				);
				expect(parentIndex.embeds[0].description).not.toContain(
					'**puzzle 1d1d1**'
				);
				const oldParent = before.rounds.find(
					(round) => round.id === first.parentId
				);
				expect(
					serverState.messages.get(
						oldParent.discord.indexChannelId
					)[0].embeds[0].description
				).toContain('**puzzle 1d1d1**');
			} finally {
				await handler({
					before: after,
					after: before,
					changes: changes.map((change) => ({
						...change,
						before: change.after,
						after: change.before,
					})),
				});
			}
		});

		it('updates moved rounds and all descendant permissions using current ancestry', async () => {
			const guild = mockDiscord.getClient().guilds.cache.at(0);
			const context = await getHuntContext(client, guild);
			const before = context.puzzlehunt.view;
			const moved = before.rounds.find(
				(round) => round.name === 'round 1d1'
			);
			const destination = before.rounds.find(
				(round) => round.name === 'round 1d2'
			);
			const movedAfter = {
				...moved,
				parentId: destination.id,
				position: 0,
			};
			const after = replacing(before, [movedAfter]);
			const handler = makeViewChangeHandler(context, () => guild);
			const viewSpy = vi
				.spyOn(context.puzzlehunt, 'view', 'get')
				.mockReturnValue(after);
			try {
				await handler({
					before,
					after,
					changes: [
						{
							type: 'node-changed',
							before: moved,
							after: movedAfter,
						},
					],
				});
				for (const node of [moved, ...moved.children]) {
					expect(
						serverState
							.findChannelBy('id', node.discord.channelId)
							.permission_overwrites.map(
								(overwrite) => overwrite.id
							)
					).toContain(destination.discord.roleId);
				}
				expect(
					serverState.messages.get(moved.discord.indexChannelId)[0]
						.embeds[0].fields
				).toContainEqual({
					name: 'Parent Round',
					value: channelRef(destination.discord.indexChannelId),
				});
			} finally {
				viewSpy.mockRestore();
				await handler({
					before: after,
					after: before,
					changes: [
						{
							type: 'node-changed',
							before: movedAfter,
							after: moved,
						},
					],
				});
			}
		});

		it('removes Discord resources for every node of a deleted subtree', async () => {
			const context = await getHuntContext(
				client,
				mockDiscord.getClient().guilds.cache.at(0)
			);
			const round = Array.from(context.puzzlehunt.rounds).find(
				(round) => round.name === 'round 1d1'
			);
			const associations = [round, ...round.children].map(
				(node) => node.discordInfo
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

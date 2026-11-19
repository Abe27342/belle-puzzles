import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest';
import { type Client, type TextChannel } from 'discord.js';
import {
	createPuzzlehuntApp,
	type HuntChangeFeed,
} from '@belle-puzzles/puzzlehunt-service/app';
import { HttpHuntDocumentClient } from '@belle-puzzles/puzzlehunt-model/http';
import {
	snowflake,
	type HuntCommand,
	type HuntScope,
} from '@belle-puzzles/puzzlehunt-model/document';
import { PostgresHuntIntegrationStore } from '@belle-puzzles/puzzlehunt-model/postgres';
import { startLocalPostgres } from '@belle-puzzles/puzzlehunt-model/testing/postgres';
import { createClient, type BelleBotClient } from '../client.js';
import { createPuzzlehuntProvider } from '../puzzlehunt-provider.js';
import {
	getHuntContext,
	resolveHuntDescriptor,
} from '../puzzlehunt-context.js';
import { createDurableIntegrationWorker } from '../sync/durableWorker.js';
import { createBelleBotApi } from '../api.js';
import type { LocalPostgresBackend } from '../local-postgres.js';
import { MockDiscord } from './mockDiscord.js';
import { runCommand } from './testUtils.js';
import * as utils from '../utils/index.js';

vi.mock('../integrations/google.js');

let database: Awaited<ReturnType<typeof startLocalPostgres>>;
let discord: MockDiscord;
let backend: LocalPostgresBackend;
let client: BelleBotClient;
let service: Server;
let metadata: Server | undefined;
let errors: Error[];
let requests: string[];
let token: string;
let loseNextCommand: boolean;
let loseNextCreate: boolean;
let changes: ReturnType<typeof vi.fn<HuntChangeFeed['subscribe']>>;
const createCommand =
	'/create name: Local hunt folder_link: https://drive.google.com/drive/folders/local-folder?usp=sharing';

async function listen(server: Server): Promise<string> {
	await new Promise<void>((resolve) =>
		server.listen(0, '127.0.0.1', resolve)
	);
	return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
async function close(server: Server | undefined): Promise<void> {
	if (server)
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve()))
		);
}
beforeAll(async () => {
	database = await startLocalPostgres();
}, 60000);
afterAll(async () => {
	await database?.close();
}, 30000);
beforeEach(async () => {
	await database.reset();
	discord = new MockDiscord();
	errors = [];
	requests = [];
	token = 'first-server-token';
	loseNextCommand = false;
	loseNextCreate = false;
	changes = vi.fn(() => {
		throw new Error('No SSE subscriptions expected');
	});
	service = createServer(
		createPuzzlehuntApp({
			store: database.store,
			changes: { subscribe: changes },
			authorize: async (authorization, guildId) => {
				expect(authorization).toBe(`Service ${token}`);
				expect(guildId).toBe(discord.getGuild().id);
			},
		})
	);
	const baseUrl = await listen(service);
	const documents = new HttpHuntDocumentClient({
		baseUrl,
		authScheme: 'Service',
		getToken: () => token,
		fetch: async (input, init) => {
			requests.push(String(input));
			const response = await fetch(input, init);
			if (
				loseNextCreate &&
				init?.method === 'POST' &&
				String(input).endsWith('/hunts')
			) {
				loseNextCreate = false;
				await response.body?.cancel();
				throw new Error('Simulated lost create response');
			}
			if (loseNextCommand && String(input).includes('/commands')) {
				loseNextCommand = false;
				await response.body?.cancel();
				throw new Error('Simulated lost committed response');
			}
			return response;
		},
	});
	backend = {
		guildIds: [discord.getGuild().id],
		documents,
		worker: makeWorker(),
		close: vi.fn(async () => {}),
	};
	client = makeClient();
});
afterEach(async () => {
	await client.shutdown();
	await close(metadata);
	metadata = undefined;
	await close(service);
	expect(changes).not.toHaveBeenCalled();
	expect(requests.every((url) => !url.includes('/changes'))).toBe(true);
	expect(errors).toEqual([]);
	vi.restoreAllMocks();
});

function makeWorker() {
	return createDurableIntegrationWorker({
		documents: database.store,
		integrations: new PostgresHuntIntegrationStore(database.pool),
		authorizedGuildIds: [discord.getGuild().id],
		getGuild: () => discord.getGuild(),
		onError: (error) => errors.push(error),
	});
}
function makeClient() {
	return createClient({
		token: 'mock',
		baseClient: discord.getClient(),
		puzzlehuntProvider: createPuzzlehuntProvider(backend.documents),
		localPostgres: backend,
		allowList: [...backend.guildIds],
		onError: async (error) => {
			errors.push(error);
		},
	});
}
async function active() {
	return database.store.readActive(discord.getGuild().id);
}
async function submit(scope: HuntScope, command: HuntCommand) {
	return database.store.submit(scope, {
		commandId: crypto.randomUUID(),
		command,
	});
}
async function model() {
	const context = await getHuntContext(client, discord.getGuild());
	if (context?.backend !== 'postgres')
		throw new Error('Expected PostgreSQL context.');
	return context.puzzlehunt;
}
async function rejectCommand(command: string) {
	await expect(runCommand(command, client, discord)).rejects.toThrow();
	expect(errors.length).toBeGreaterThan(0);
	return errors.splice(0);
}
function channelData(id: string) {
	return discord.serverState.findChannelBy('id', id);
}
async function createPuzzle() {
	await runCommand(createCommand, client, discord);
	await runCommand(
		'/add_round name: Round url: https://example.test/round',
		client,
		discord
	);
	await backend.worker.reconcile();
	let hunt = await model();
	const round = hunt.rounds[0];
	await runCommand(
		'/add_puzzle name: Puzzle url: https://example.test/puzzle',
		client,
		discord,
		channelData(round.discord.indexChannelId)
	);
	await backend.worker.reconcile();
	hunt = await model();
	return { hunt, round: hunt.rounds[0], puzzle: hunt.puzzles[0] };
}
async function metadataUrl(authorize = vi.fn(async () => true)) {
	metadata = createServer(createBelleBotApi(client, authorize));
	return `${await listen(metadata)}/guilds/${
		discord.getGuild().id
	}/puzzlehunt`;
}

describe('HTTP-backed local bot', () => {
	it('creates and selects a requested hunt, retaining only an untouched initializer seed', async () => {
		const seed = await database.store.create(discord.getGuild().id, {
			name: 'Initializer seed',
		});
		const interaction = await runCommand(createCommand, client, discord);
		expect(interaction.editReply).toHaveBeenNthCalledWith(
			1,
			'Creating puzzle hunt...'
		);
		expect(interaction.editReply).toHaveBeenLastCalledWith(
			'Puzzle hunt created!'
		);
		const snapshot = await active();
		expect(snapshot.huntId).not.toBe(seed.huntId);
		expect(snapshot.document.name).toBe('Local hunt');
		expect(snapshot.document.configuration).toEqual({
			googleFolderId: 'local-folder',
			indexId: expect.any(String),
			allPuzzlesRoleId: expect.any(String),
			loggingChannelIds: {
				puzzleAdd: expect.any(String),
				puzzleSolve: expect.any(String),
				puzzleStatusUpdate: expect.any(String),
			},
		});
		expect(
			(await database.store.list(discord.getGuild().id)).hunts
		).toHaveLength(2);
		expect(await database.store.read(seed)).toEqual(seed);
		const admin = discord.serverState.channels.find(
			(channel) => channel.name === 'belle-bot-admin'
		);
		const pin = discord.serverState.messages.get(admin.id)[0];
		expect(JSON.parse(pin.content)).toEqual({
			backend: 'postgres',
			version: 1,
			guildId: discord.getGuild().id,
		});
		expect(pin.pinned).toBe(true);
		expect(discord.serverState.channels).toHaveLength(5);
	});

	it('serializes simultaneous local creates instead of provisioning twice', async () => {
		const interactions = vi.spyOn(discord, 'createCommandInteraction');
		const results = await Promise.allSettled([
			runCommand(createCommand, client, discord),
			runCommand(createCommand, client, discord),
		]);
		expect(results.some((result) => result.status === 'rejected')).toBe(
			true
		);
		expect(errors.splice(0).map((error) => error.message)).toEqual([
			'An existing PostgreSQL hunt or partial setup was found. Inspect it; do not rerun /create.',
		]);
		expect(
			(await database.store.list(discord.getGuild().id)).hunts
		).toHaveLength(1);
		expect(
			discord.serverState.channels.filter(
				(channel) => channel.name === 'belle-bot-admin'
			)
		).toHaveLength(1);
		for (const result of interactions.mock.results) {
			expect(result.value.deferReply).toHaveBeenCalledOnce();
		}
	});

	it('rejects an empty folder ID before creating a document or external resources', async () => {
		await runCommand(
			'/create name: Invalid folder_link: https://drive.google.com/drive/folders/?usp=sharing',
			client,
			discord
		);
		expect(
			(await database.store.list(discord.getGuild().id)).hunts
		).toEqual([]);
		expect(discord.serverState.channels).toEqual([]);
	});

	it.each(['configured', 'nonempty', 'modified-empty', 'multiple'])(
		'refuses replacing %s hunts even without a Discord pin',
		async (kind) => {
			const seed = await database.store.create(discord.getGuild().id, {
				name: 'Existing',
				configuration:
					kind === 'configured'
						? { googleFolderId: 'already-set' }
						: {},
			});
			if (kind === 'nonempty')
				await submit(seed, {
					type: 'add',
					nodes: [
						{
							id: crypto.randomUUID(),
							type: 'round',
							name: 'Round',
							url: '',
						},
					],
				});
			if (kind === 'modified-empty')
				await submit(seed, {
					type: 'update-configuration',
					configuration: {},
				});
			if (kind === 'multiple')
				await database.store.create(seed.guildId, {
					name: 'Another seed',
				});
			const before = await database.store.list(seed.guildId);
			const failed = await rejectCommand(createCommand);
			expect(failed[0].message).toContain('do not rerun /create');
			expect(await database.store.list(seed.guildId)).toEqual(before);
			expect(discord.serverState.channels).toEqual([]);
		}
	);

	it('surfaces partial provisioning and refuses a blind rerun', async () => {
		vi.spyOn(discord.getGuild().roles, 'create').mockRejectedValueOnce(
			new Error('Uncertain role creation')
		);
		expect((await rejectCommand(createCommand))[0].message).toContain(
			'Setup may be partial'
		);
		const snapshot = await active();
		expect(snapshot.document.configuration).toEqual({
			googleFolderId: 'local-folder',
		});
		await runCommand(createCommand, client, discord);
		expect(
			(await database.store.list(snapshot.guildId)).hunts
		).toHaveLength(1);
		await expect(
			resolveHuntDescriptor(client, discord.getGuild())
		).rejects.toThrow('no unique backend pin');
	});

	it('does not mistake a response-lost create for an untouched seed', async () => {
		loseNextCreate = true;
		expect((await rejectCommand(createCommand))[0].message).toContain(
			'outcome uncertain'
		);
		expect(discord.serverState.channels).toEqual([]);
		expect((await active()).document.configuration.googleFolderId).toBe(
			'local-folder'
		);
		await rejectCommand(createCommand);
		expect(
			(await database.store.list(discord.getGuild().id)).hunts
		).toHaveLength(1);
		expect(discord.serverState.channels).toEqual([]);
	});

	it('does not publish the backend pin or saved-success reply before configuration acknowledgement', async () => {
		const submitCommand = database.store.submit.bind(database.store);
		let release: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const committed = vi.fn();
		vi.spyOn(database.store, 'submit').mockImplementationOnce(
			async (scope, request) => {
				const result = await submitCommand(scope, request);
				committed();
				await gate;
				return result;
			}
		);
		const interactions = vi.spyOn(discord, 'createCommandInteraction');
		const creating = runCommand(createCommand, client, discord);
		await vi.waitFor(() => expect(committed).toHaveBeenCalledOnce());
		const interaction = interactions.mock.results[0].value;
		expect(interaction.editReply).toHaveBeenCalledExactlyOnceWith(
			'Creating puzzle hunt...'
		);
		expect([...discord.serverState.messages.values()].flat()).toEqual([]);
		release();
		await creating;
		expect(interaction.editReply).toHaveBeenLastCalledWith(
			'Puzzle hunt created!'
		);
	});

	it('awaits HTTP mutation acknowledgement before reporting an added round as saved', async () => {
		await runCommand(createCommand, client, discord);
		const submitCommand = database.store.submit.bind(database.store);
		let release: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const committed = vi.fn();
		vi.spyOn(database.store, 'submit').mockImplementationOnce(
			async (scope, request) => {
				const result = await submitCommand(scope, request);
				committed();
				await gate;
				return result;
			}
		);
		const interactions = vi.spyOn(discord, 'createCommandInteraction');
		const adding = runCommand(
			'/add_round name: Pending url: https://example.test',
			client,
			discord
		);
		await vi.waitFor(() => expect(committed).toHaveBeenCalledOnce());
		const interaction = interactions.mock.results[0].value;
		expect(interaction.editReply).not.toHaveBeenCalled();
		release();
		await adding;
		expect(interaction.editReply).toHaveBeenCalledWith(
			'Round "Pending" added.'
		);
	});

	it('refreshes without SSE, waits for saves, and leaves external effects to the worker', async () => {
		await runCommand(createCommand, client, discord);
		const hunt = await model();
		const channelsBefore = discord.serverState.channels.length;
		const roundReply = await runCommand(
			'/add_round name: First url: https://example.test',
			client,
			discord
		);
		expect(roundReply.editReply).toHaveBeenLastCalledWith(
			'Round "First" added.'
		);
		expect(Object.values((await active()).document.nodes)).toMatchObject([
			{ name: 'First' },
		]);
		expect(discord.serverState.channels).toHaveLength(channelsBefore);
		expect(hunt.rounds[0].discord).toBeUndefined();
		await backend.worker.reconcile();
		token = 'rotated-server-token';
		const puzzleReply = await runCommand(
			'/add_puzzle name: Puzzle url: https://example.test',
			client,
			discord,
			channelData((await model()).rounds[0].discord.indexChannelId)
		);
		expect(puzzleReply.editReply).toHaveBeenLastCalledWith(
			'Puzzle "Puzzle" added.'
		);
		expect(Object.values((await active()).document.nodes)).toHaveLength(2);
		expect(hunt.puzzles[0].discord).toBeUndefined();
		await backend.worker.reconcile();
		expect((await model()).puzzles[0].discord).toBeDefined();
	});

	it('saves status, solve, unsolve and edits without duplicate direct logs or clear-status commands', async () => {
		const { hunt, puzzle } = await createPuzzle();
		const source = channelData(puzzle.discord.channelId);
		const log = hunt.loggingChannelIds.puzzleSolve;
		const before = (discord.serverState.messages.get(log) ?? []).length;
		await runCommand(
			'/update_status status: Thinking',
			client,
			discord,
			source
		);
		await runCommand('/solve answer: ANSWER', client, discord, source);
		let node = (await active()).document.nodes[puzzle.id];
		expect(node).toMatchObject({ answer: 'ANSWER' });
		expect(node).not.toHaveProperty('status');
		expect(node).not.toHaveProperty('lastStatusUpdate');
		expect(discord.serverState.messages.get(log)).toHaveLength(before);
		const { rows } = await database.pool.query(
			"SELECT payload->'event'->>'type' AS type FROM integration_events WHERE hunt_id = $1 AND payload->'event'->>'type' IN ('puzzle-solved', 'puzzle-status-updated') ORDER BY revision",
			[hunt.committedSnapshot.huntId]
		);
		expect(rows).toEqual([
			{ type: 'puzzle-status-updated' },
			{ type: 'puzzle-solved' },
		]);
		await backend.worker.reconcile();
		expect(discord.serverState.messages.get(log)).toHaveLength(before + 1);
		await runCommand('/unsolve', client, discord, source);
		await runCommand(
			'/edit name new_name: Renamed',
			client,
			discord,
			source
		);
		await runCommand(
			'/edit url new_url: https://example.test/new',
			client,
			discord,
			source
		);
		await runCommand(
			'/edit sheet_id new_sheet_id: manual-sheet',
			client,
			discord,
			source
		);
		node = (await active()).document.nodes[puzzle.id];
		expect(node).toMatchObject({
			name: 'Renamed',
			url: 'https://example.test/new',
			sheetId: 'manual-sheet',
		});
		expect(node).not.toHaveProperty('answer');
	});

	it('retains uncertain writes, blocks new mutations, and explicitly retries the same IDs', async () => {
		await runCommand(createCommand, client, discord);
		const hunt = await model();
		loseNextCommand = true;
		expect(
			(
				await rejectCommand(
					'/add_round name: Uncertain url: https://example.test'
				)
			)[0].message
		).toContain('/retry_pending hunt_id:');
		const retained = hunt.pendingChanges[0].request.commandId;
		expect(hunt.pendingChanges).toHaveLength(1);
		expect(
			(
				await rejectCommand(
					'/add_round name: Must not run url: https://example.test'
				)
			)[0].message
		).toContain(retained);
		expect(hunt.pendingChanges[0].request.commandId).toBe(retained);
		await runCommand(
			`/retry_pending hunt_id: ${hunt.committedSnapshot.huntId}`,
			client,
			discord
		);
		expect(hunt.pendingChanges).toEqual([]);
		expect(Object.values((await active()).document.nodes)).toMatchObject([
			{ name: 'Uncertain' },
		]);
	});

	it('rejects Fluid migration/reset commands and routes sync through the durable worker', async () => {
		await runCommand(createCommand, client, discord);
		for (const command of [
			'/copy_to_new_fluid_file',
			'/change_backing_file id: other',
			'/reset_server',
		]) {
			expect((await rejectCommand(command))[0].message).toContain(
				'PostgreSQL'
			);
		}
		const reconcile = vi.spyOn(backend.worker, 'reconcile');
		const reply = await runCommand('/sync_all', client, discord);
		expect(reconcile).toHaveBeenCalledOnce();
		expect(reply.editReply).toHaveBeenNthCalledWith(
			1,
			'Re-syncing all discord state to reflect the puzzle hunt. This may take a while...'
		);
		expect(reply.editReply).toHaveBeenLastCalledWith('Complete!');
		const resyncReply = await runCommand('/resync_all', client, discord);
		expect(resyncReply.editReply).toHaveBeenLastCalledWith('Complete!');
		expect(reconcile).toHaveBeenCalledTimes(2);
	});

	it('settles channel reparent moves after refreshing worker associations', async () => {
		const { puzzle, hunt } = await createPuzzle();
		await runCommand(
			'/add_round name: Second url: https://example.test',
			client,
			discord
		);
		await backend.worker.reconcile();
		const refreshed = await model();
		const oldChannel = discord
			.getGuild()
			.channels.cache.get(puzzle.discord.channelId) as TextChannel;
		const second = refreshed.rounds.find(
			(round) => round.name === 'Second'
		);
		const oldParent = oldChannel.parentId;
		const newChannel = await oldChannel.edit({
			parent: second.discord.channelId,
		});
		// Discord returns a separate update event with the previous channel snapshot.
		const previous = Object.assign(
			Object.create(Object.getPrototypeOf(oldChannel)),
			oldChannel,
			{ parentId: oldParent }
		);
		client.emit('channelUpdate', previous, newChannel);
		await client.ensurePendingWorkProcessed();
		expect(
			(await database.store.read(hunt.committedSnapshot)).document.nodes[
				puzzle.id
			].parentId
		).toBe(second.id);
	});

	it('starts independently of lazy model loads and catches up inactive hunts after a worker restart', async () => {
		await runCommand(createCommand, client, discord);
		const original = await active();
		await submit(original, {
			type: 'add',
			nodes: [
				{
					id: crypto.randomUUID(),
					type: 'round',
					name: 'Offline',
					url: '',
				},
			],
		});
		const seed = await database.store.create(original.guildId, {
			name: 'Unconfigured active seed',
		});
		await client.shutdown();
		backend = { ...backend, worker: makeWorker() };
		client = makeClient();
		const load = vi.spyOn(
			client.puzzlehuntProvider,
			'getPostgresPuzzlehunt'
		);
		const start = vi.spyOn(backend.worker, 'start');
		client.emit('clientReady', client as Client<true>);
		client.emit('clientReady', client as Client<true>);
		await client.ensurePendingWorkProcessed();
		expect(start).toHaveBeenCalledOnce();
		expect(load).not.toHaveBeenCalled();
		expect(
			Object.values(
				(await database.store.read(original)).document.nodes
			)[0].discord
		).toBeDefined();
		expect(await database.store.read(seed)).toEqual(seed);
		expect(errors.splice(0).map((error) => error.message)).toEqual([
			'Hunt is not configured: googleFolderId, indexId and allPuzzlesRoleId are required.',
		]);
	});
});

describe('Authorized public bot metadata', () => {
	it('authorizes before reading pins, selecting active hunts, or loading models', async () => {
		const authorize = vi.fn(async () => false);
		const url = await metadataUrl(authorize);
		const activeRead = vi.spyOn(backend.documents, 'readActive');
		const load = vi.spyOn(client.puzzlehuntProvider, 'getPuzzlehunt');
		const pin = vi.spyOn(utils, 'getHuntContextMessage');
		expect((await fetch(url)).status).toBe(401);
		expect(authorize).not.toHaveBeenCalled();
		expect(
			(
				await fetch(url, {
					headers: { Authorization: 'Bearer unauthorized' },
				})
			).status
		).toBe(401);
		expect(authorize).toHaveBeenCalledOnce();
		expect(activeRead).not.toHaveBeenCalled();
		expect(load).not.toHaveBeenCalled();
		expect(pin).not.toHaveBeenCalled();
	});

	it('returns only the exact active hunt descriptor, not a message, model, or credential', async () => {
		await runCommand(createCommand, client, discord);
		const original = await active();
		const next = await database.store.create(original.guildId, {
			name: 'Selected later',
			configuration: original.document.configuration,
		});
		const load = vi.spyOn(
			client.puzzlehuntProvider,
			'getPostgresPuzzlehunt'
		);
		const response = await fetch(await metadataUrl(), {
			headers: { Authorization: 'Bearer member' },
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			backend: 'postgres',
			guildId: next.guildId,
			huntId: next.huntId,
			name: 'Selected later',
			configuration: original.document.configuration,
		});
		expect(load).not.toHaveBeenCalled();
	});

	it('reports disabled, incomplete, missing and service-unavailable hunts without falling back', async () => {
		const url = await metadataUrl();
		const get = () =>
			fetch(url, { headers: { Authorization: 'Bearer member' } });
		expect((await get()).status).toBe(404);
		await runCommand(createCommand, client, discord);
		client.localPostgres = undefined;
		expect((await get()).status).toBe(403);
		expect((await rejectCommand(createCommand))[0].message).toContain(
			'cannot be replaced with a Fluid hunt'
		);
		expect((await rejectCommand('/reset_server'))[0].message).toContain(
			'even when PostgreSQL is disabled'
		);
		client.localPostgres = backend;
		await database.store.create(discord.getGuild().id, {
			name: 'Incomplete',
		});
		expect((await get()).status).toBe(409);
		await database.pool.query('DELETE FROM active_hunts');
		expect((await get()).status).toBe(404);
		vi.spyOn(backend.documents, 'readActive').mockRejectedValueOnce(
			new Error('Unavailable')
		);
		expect((await get()).status).toBe(503);
	});

	it('does not reinterpret a legacy Fluid pin in an opted-in guild', async () => {
		await runCommand(createCommand, client, discord);
		const admin = discord
			.getGuild()
			.channels.cache.find(
				(channel) => channel.name === 'belle-bot-admin'
			) as TextChannel;
		const pin = admin.messages.cache.first();
		const legacy = {
			name: 'Fluid',
			fluidFileId: 'existing-file',
			googleFolderId: 'folder',
			indexId: 'index',
			allPuzzlesRoleId: 'role',
		};
		await pin.edit(JSON.stringify(legacy));
		const activeRead = vi.spyOn(backend.documents, 'readActive');
		const response = await fetch(await metadataUrl(), {
			headers: { Authorization: 'Bearer member' },
		});
		expect(await response.json()).toEqual({ backend: 'fluid', ...legacy });
		expect(activeRead).not.toHaveBeenCalled();
	});

	it('rejects guilds outside the local bot allow list before metadata resolution', async () => {
		const url = await metadataUrl();
		client.isGuildAllowed = () => false;
		expect(
			(await fetch(url, { headers: { Authorization: 'Bearer member' } }))
				.status
		).toBe(404);
	});
});

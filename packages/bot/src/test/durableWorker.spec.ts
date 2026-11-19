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
import { ChannelType, PermissionsBitField } from 'discord.js';
import {
	snowflake,
	type HuntCommand,
	type HuntScope,
} from '@belle-puzzles/puzzlehunt-model/document';
import {
	PostgresHuntIntegrationStore,
	OwnedHuntIntegrations,
} from '@belle-puzzles/puzzlehunt-model/postgres';
import { startLocalPostgres } from '@belle-puzzles/puzzlehunt-model/testing/postgres';
import { MockDiscord } from './mockDiscord.js';
import {
	createDurableIntegrationWorker,
	type DurableIntegrationWorker,
	type DurableIntegrationWorkerOptions,
} from '../sync/durableWorker.js';

vi.mock('../integrations/google.js');

let database: Awaited<ReturnType<typeof startLocalPostgres>>;
let integrations: PostgresHuntIntegrationStore;
let discord: MockDiscord;
let scope: HuntScope;
let rootId: string;
let roundId: string;
let puzzleId: string;
let createSheet: ReturnType<
	typeof vi.fn<DurableIntegrationWorkerOptions['createSheet']>
>;
let errors: Error[];
let workers: DurableIntegrationWorker[];
let owners: OwnedHuntIntegrations[];

beforeAll(async () => {
	database = await startLocalPostgres();
}, 60000);
afterAll(async () => {
	await database?.close();
}, 30000);
beforeEach(async () => {
	await database.reset();
	discord = new MockDiscord({ intents: [], rest: { retries: 0 } });
	integrations = new PostgresHuntIntegrationStore(database.pool);
	errors = [];
	workers = [];
	owners = [];
	let sheets = 0;
	createSheet = vi.fn(async () => `sheet-${++sheets}`);
	const guild = discord.getGuild();
	const index = await guild.channels.create({
		name: 'Index',
		type: ChannelType.GuildCategory,
	});
	const role = await guild.roles.create({ name: 'All puzzles' });
	const logs = await guild.channels.create({ name: 'Log' });
	scope = await database.store.create(guild.id, {
		name: 'Durable hunt',
		configuration: {
			googleFolderId: 'folder',
			indexId: snowflake(index.id),
			allPuzzlesRoleId: snowflake(role.id),
			loggingChannelIds: {
				puzzleAdd: snowflake(logs.id),
				puzzleSolve: snowflake(logs.id),
				puzzleStatusUpdate: snowflake(logs.id),
			},
		},
	});
	rootId = crypto.randomUUID();
	roundId = crypto.randomUUID();
	puzzleId = crypto.randomUUID();
	await submit({
		type: 'add',
		nodes: [
			{ id: rootId, type: 'round', name: 'Root', url: '' },
			{
				id: roundId,
				type: 'round',
				name: 'Round',
				url: '',
				parentId: rootId,
			},
			{
				id: puzzleId,
				type: 'puzzle',
				name: 'Puzzle',
				url: '',
				parentId: roundId,
			},
		],
	});
});
afterEach(async () => {
	await Promise.all(workers.map((worker) => worker.stop()));
	await Promise.all(owners.map((owner) => owner.release()));
	vi.restoreAllMocks();
});

async function own(): Promise<OwnedHuntIntegrations> {
	const owner = await integrations.acquire(scope);
	if (!owner) throw new Error('Expected available ownership');
	owners.push(owner);
	return owner;
}

async function submit(command: HuntCommand): Promise<void> {
	await database.store.submit(scope, {
		commandId: crypto.randomUUID(),
		command,
	});
}

function worker(
	overrides: Partial<DurableIntegrationWorkerOptions> = {}
): DurableIntegrationWorker {
	const instance = createDurableIntegrationWorker({
		integrations,
		documents: database.store,
		authorizedGuildIds: [scope.guildId],
		getGuild: () => discord.getGuild(),
		onError: (error) => errors.push(error),
		createSheet,
		retryBaseMs: 10000,
		...overrides,
	});
	workers.push(instance);
	return instance;
}

async function makeDue(): Promise<void> {
	await database.pool.query(
		"UPDATE integration_jobs SET available_at = now() - interval '1 second'"
	);
	await database.pool.query(
		"UPDATE integration_events SET available_at = now() - interval '1 second'"
	);
	await database.pool.query(
		"UPDATE integration_progress SET available_at = now() - interval '1 second'"
	);
}

function messages(): string[] {
	return [...discord.serverState.messages.values()]
		.flat()
		.map((message) => message.content)
		.filter(Boolean);
}

describe('Durable integration worker', () => {
	it('catches up from committed state on startup without opening a website or cached model', async () => {
		await submit({
			type: 'set-property',
			nodeId: puzzleId,
			property: 'name',
			value: 'Latest puzzle',
		});
		const instance = worker();
		await instance.start();
		await instance.stop();
		const snapshot = await database.store.read(scope);
		const puzzle = snapshot.document.nodes[puzzleId];
		expect(puzzle).toMatchObject({
			sheetId: 'sheet-1',
			discord: { channelId: expect.any(String) },
		});
		expect(createSheet).toHaveBeenCalledExactlyOnceWith(
			'Latest puzzle',
			'folder',
			{ retry: false, timeout: 30000 }
		);
		const channel = discord.serverState.findChannelBy(
			'id',
			puzzle.discord!.channelId
		);
		expect(channel.parent_id).toBe(
			snapshot.document.nodes[roundId].discord!.channelId
		);
		expect(
			channel.permission_overwrites!.map((entry) => entry.id)
		).toContain(snapshot.document.nodes[rootId].discord!.roleId);
		expect(messages()).toEqual([
			'New puzzle unlocked in round "Round": "Puzzle".',
		]);
		expect(errors).toEqual([]);
		const counts = [
			discord.serverState.roles.length,
			discord.serverState.channels.length,
		];
		await worker().reconcile();
		expect([
			discord.serverState.roles.length,
			discord.serverState.channels.length,
		]).toEqual(counts);
		expect(createSheet).toHaveBeenCalledTimes(1);
		expect(
			(
				await database.pool.query(
					'SELECT id FROM integration_jobs WHERE completed_at IS NULL AND cancelled_at IS NULL'
				)
			).rows
		).toEqual([]);
	});

	it('honors scan bounds and never touches an unauthorized guild', async () => {
		await database.store.create('unrelated', {
			name: 'Unconfigured unrelated hunt',
		});
		const instance = worker({
			jobsPerHunt: 1,
			nodesPerHunt: 1,
			eventsPerHunt: 1,
		});
		await instance.reconcile();
		expect(
			(
				await database.pool.query(
					'SELECT id FROM integration_jobs WHERE completed_at IS NOT NULL'
				)
			).rows.length
		).toBeLessThanOrEqual(1);
		for (let i = 0; i < 10; i++) {
			await makeDue();
			await instance.reconcile();
		}
		expect(
			(await database.store.read(scope)).document.nodes[puzzleId]
		).toHaveProperty('sheetId');
		expect(createSheet).toHaveBeenCalledTimes(1);
	});

	it('defers unconfigured seed hunts without provisioning', async () => {
		await database.pool.query(
			"UPDATE hunts SET configuration = '{}'::jsonb WHERE id = $1",
			[scope.huntId]
		);
		const before = discord.serverState.channels.length;
		await worker().reconcile();
		expect(discord.serverState.channels).toHaveLength(before);
		expect(createSheet).not.toHaveBeenCalled();
		expect(
			errors.some((error) => error.message.includes('not configured'))
		).toBe(true);
		expect(
			(await database.pool.query('SELECT * FROM integration_progress'))
				.rows
		).toEqual([]);
	});

	it('refuses SDK-level blind transport retries before creating or sending', async () => {
		const unsafe = new MockDiscord();
		await worker({ getGuild: () => unsafe.getGuild() }).reconcile();
		expect(createSheet).not.toHaveBeenCalled();
		expect(unsafe.serverState.channels).toEqual([]);
		expect(errors[0].message).toContain('REST retries: 0');
	});

	it('excludes a second worker and waits for in-flight work during shutdown', async () => {
		let finish!: (value: string) => void;
		createSheet.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				})
		);
		const first = worker();
		const pass = first.reconcile();
		await vi.waitFor(() => expect(createSheet).toHaveBeenCalledTimes(1));
		await worker().reconcile();
		expect(createSheet).toHaveBeenCalledTimes(1);
		let stopped = false;
		const stopping = first.stop().then(() => {
			stopped = true;
		});
		await Promise.resolve();
		expect(stopped).toBe(false);
		finish('confirmed-sheet');
		await pass;
		await stopping;
		const next = await own();
		expect(next).toBeDefined();
		await next.release();
		expect(
			(await database.store.read(scope)).document.nodes[puzzleId]
		).toHaveProperty('sheetId', 'confirmed-sheet');
	});

	it('backs off known failures, reuses independently confirmed Discord IDs, and retries on a later pass', async () => {
		const guild = discord.getGuild();
		const original = guild.channels.create.bind(guild.channels);
		const rejected = new Error('Rejected before creation');
		vi.spyOn(guild.channels, 'create')
			.mockImplementationOnce(async () => {
				throw rejected;
			})
			.mockImplementation(original);
		const first = worker({
			isKnownNoEffect: (error) => error === rejected,
		});
		await first.reconcile();
		const { rows: failed } = await database.pool.query(
			`SELECT attempts, last_error, available_at > now() AS delayed FROM integration_jobs
			 WHERE node_id = $1 AND target = 'discord'`,
			[rootId]
		);
		expect(failed[0]).toMatchObject({
			attempts: 1,
			delayed: true,
			last_error: expect.stringContaining('Rejected'),
		});
		const owner = await own();
		const progress = (await owner.progress(rootId, 'discord'))!;
		await owner.release();
		expect(progress.pending).toEqual([]);
		expect(progress.confirmed).toHaveProperty('role');
		expect(progress.confirmed).toHaveProperty('indexChannel');
		const roles = discord.serverState.roles.length;
		await first.reconcile();
		expect(discord.serverState.roles).toHaveLength(roles);
		await makeDue();
		await first.reconcile();
		const root = (await database.store.read(scope)).document.nodes[rootId];
		expect(root.discord!.roleId).toBe(progress.confirmed.role);
		expect(root.discord!.indexChannelId).toBe(
			progress.confirmed.indexChannel
		);
		expect(
			discord.serverState.roles.filter((role) => role.name === 'Root')
		).toHaveLength(1);
	});

	it('pauses interrupted creates across restart and later jobs for the same node/target', async () => {
		const owner = await own();
		const job = (await owner.dueJobs()).find(
			(value) => value.target === 'google'
		)!;
		await owner.beginOperation(puzzleId, 'google', 'sheet', job.id, {
			name: 'Puzzle',
			googleFolderId: 'folder',
		});
		await owner.release();
		await worker().reconcile();
		await submit({
			type: 'set-property',
			nodeId: puzzleId,
			property: 'name',
			value: 'Changed later',
		});
		await makeDue();
		await worker().reconcile();
		expect(createSheet).not.toHaveBeenCalled();
		const { rows } = await database.pool.query(
			`SELECT paused_at IS NOT NULL AS paused, last_error FROM integration_jobs WHERE id = $1`,
			[job.id]
		);
		expect(rows[0]).toMatchObject({
			paused: true,
			last_error: expect.stringContaining('Manual inspection'),
		});
	});

	it('retains a pause and reports the external ID if a successful creation cannot be checkpointed', async () => {
		const checkpoint = OwnedHuntIntegrations.prototype.confirmOperation;
		vi.spyOn(
			OwnedHuntIntegrations.prototype,
			'confirmOperation'
		).mockImplementation(async function (...args) {
			if (args[1] === 'google')
				throw new Error('Checkpoint connection failed');
			return checkpoint.apply(this, args);
		});
		await worker().reconcile();
		vi.restoreAllMocks();
		await makeDue();
		await worker().reconcile();
		expect(createSheet).toHaveBeenCalledTimes(1);
		expect(
			(await database.store.read(scope)).document.nodes[puzzleId]
		).not.toHaveProperty('sheetId');
		const owner = await own();
		expect(await owner.progress(puzzleId, 'google')).toMatchObject({
			pending: ['sheet'],
			intents: { sheet: { name: 'Puzzle', googleFolderId: 'folder' } },
			blockedError: expect.stringContaining('sheet-1'),
		});
		await owner.release();
		expect(
			errors.some((error) =>
				error.message.includes('confirmed external ID sheet-1')
			)
		).toBe(true);
	});

	it('reuses checkpointed embed messages after a pin failure instead of sending again', async () => {
		const put = vi
			.mocked(discord.getClient().rest.put)
			.getMockImplementation()!;
		vi.spyOn(discord.getClient().rest, 'put')
			.mockRejectedValueOnce(new Error('Pin unavailable'))
			.mockImplementation(put);
		await worker().reconcile();
		const messageCount = [...discord.serverState.messages.values()].flat()
			.length;
		expect(
			errors.some((error) => error.message.includes('Pin unavailable'))
		).toBe(true);
		await worker().reconcile();
		expect([...discord.serverState.messages.values()].flat()).toHaveLength(
			messageCount
		);
		expect(errors.map((error) => error.message)).toEqual([
			expect.stringContaining('Pin unavailable'),
		]);
		expect(
			[...discord.serverState.messages.values()]
				.flat()
				.filter((message) => message.embeds?.length)
				.every((message) => message.pinned)
		).toBe(true);
	});

	it('does not duplicate uncheckpointed embed sends on restart', async () => {
		const checkpoint = OwnedHuntIntegrations.prototype.confirmOperation;
		vi.spyOn(
			OwnedHuntIntegrations.prototype,
			'confirmOperation'
		).mockImplementation(async function (...args) {
			if (args[1] === 'embed')
				throw new Error('Crash before saving message ID');
			return checkpoint.apply(this, args);
		});
		await worker().reconcile();
		const count = [...discord.serverState.messages.values()].flat().length;
		vi.restoreAllMocks();
		await worker().reconcile();
		expect([...discord.serverState.messages.values()].flat()).toHaveLength(
			count
		);
		expect(
			errors.some((error) =>
				error.message.includes('unconfirmed operations')
			)
		).toBe(true);
	});

	it('periodically discovers commands committed after startup without notification hints', async () => {
		const instance = worker({ intervalMs: 20 });
		await instance.start();
		const laterId = crypto.randomUUID();
		await submit({
			type: 'add',
			nodes: [
				{
					id: laterId,
					type: 'puzzle',
					name: 'Later',
					url: '',
					parentId: roundId,
				},
			],
		});
		await vi.waitFor(async () => {
			expect(
				(await database.store.read(scope)).document.nodes[laterId]
			).toHaveProperty('sheetId');
		});
		await instance.stop();
		expect(createSheet).toHaveBeenCalledTimes(2);
	});

	it('preserves confirmed results when a manual association races sheet creation', async () => {
		createSheet.mockImplementationOnce(async () => {
			await submit({
				type: 'set-property',
				nodeId: puzzleId,
				property: 'sheetId',
				value: 'manual-sheet',
			});
			return 'created-sheet';
		});
		await worker().reconcile();
		expect(
			(await database.store.read(scope)).document.nodes[puzzleId]
		).toHaveProperty('sheetId', 'manual-sheet');
		const owner = await own();
		expect(await owner.progress(puzzleId, 'google')).toMatchObject({
			confirmed: { sheet: 'created-sheet' },
			blockedError: expect.stringContaining('rejected'),
		});
		await owner.release();
		await makeDue();
		await worker().reconcile();
		expect(createSheet).toHaveBeenCalledTimes(1);
	});

	it('cannot attach cancelled results to a replacement node and retains their diagnostics', async () => {
		createSheet.mockImplementationOnce(async () => {
			await submit({ type: 'delete', nodeId: puzzleId });
			await submit({
				type: 'add',
				nodes: [
					{
						id: puzzleId,
						type: 'puzzle',
						parentId: roundId,
						name: 'Replacement',
						url: '',
					},
				],
			});
			return 'orphan-sheet';
		});
		await worker().reconcile();
		await worker().reconcile();
		expect(
			(await database.store.read(scope)).document.nodes[puzzleId]
		).not.toHaveProperty('sheetId');
		const owner = await own();
		expect(await owner.progress(puzzleId, 'google')).toMatchObject({
			confirmed: { sheet: 'orphan-sheet' },
			blockedError: expect.stringContaining('rejected'),
		});
		await owner.release();
		expect(createSheet).toHaveBeenCalledTimes(1);
	});

	it('delivers distinct historical logs in order, and deletes tombstone IDs without deleting sheets', async () => {
		await worker().reconcile();
		const puzzle = (await database.store.read(scope)).document.nodes[
			puzzleId
		];
		await submit({
			type: 'set-property',
			nodeId: puzzleId,
			property: 'status',
			value: 'First status',
		});
		await submit({
			type: 'set-property',
			nodeId: puzzleId,
			property: 'status',
			value: 'Second status',
		});
		await submit({
			type: 'set-property',
			nodeId: puzzleId,
			property: 'answer',
			value: 'ANSWER',
		});
		await submit({ type: 'delete', nodeId: puzzleId });
		await worker().reconcile();
		expect(messages()).toEqual([
			'New puzzle unlocked in round "Round": "Puzzle".',
			'Status updated for Puzzle: "First status".',
			'Status updated for Puzzle: "Second status".',
			'Puzzle solved! Answer: "ANSWER".',
		]);
		expect(
			discord.serverState.channels.some(
				(value) => value.id === puzzle.discord!.channelId
			)
		).toBe(false);
		expect(
			discord.serverState.roles.some(
				(value) => value.id === puzzle.discord!.roleId
			)
		).toBe(false);
		expect(createSheet).toHaveBeenCalledTimes(1);
		await worker().reconcile();
		expect(messages()).toHaveLength(4);
		expect(
			(
				await database.pool.query(
					'SELECT * FROM integration_events WHERE delivered_at IS NULL'
				)
			).rows
		).toEqual([]);
	});

	it('pauses a log with a lost send response and does not resend after restart', async () => {
		const snapshot = await database.store.read(scope);
		const channel = discord
			.getGuild()
			.channels.cache.get(
				snapshot.document.configuration.loggingChannelIds!.puzzleAdd
			)!;
		if (!channel.isTextBased()) throw new Error('Expected logging channel');
		const send = channel.send.bind(channel);
		vi.spyOn(channel, 'send').mockImplementationOnce(async (content) => {
			await send(content);
			throw new Error('Response lost after delivery');
		});

		await worker().reconcile();
		await makeDue();
		await worker().reconcile();
		expect(messages()).toEqual([
			'New puzzle unlocked in round "Round": "Puzzle".',
		]);
		const { rows } = await database.pool.query(
			`SELECT last_error FROM integration_events WHERE paused_at IS NOT NULL`
		);
		expect(rows).toHaveLength(1);
		expect(rows[0].last_error).toContain('Manual delivery inspection');
	});

	it('counts and backs off event attempts even when the logging channel is unavailable before sending', async () => {
		const snapshot = await database.store.read(scope);
		const guild = discord.getGuild();
		const channelId =
			snapshot.document.configuration.loggingChannelIds!.puzzleAdd;
		const channel = guild.channels.cache.get(channelId)!;
		guild.channels.cache.delete(channelId);
		const instance = worker();
		await instance.reconcile();
		await makeDue();
		await instance.reconcile();
		const { rows } = await database.pool.query(
			`SELECT attempts, last_error, available_at > now() + interval '15 seconds' AS backed_off,
			 delivery_started_at FROM integration_events WHERE delivered_at IS NULL`
		);
		expect(rows).toEqual([
			{
				attempts: 2,
				last_error: expect.stringContaining('unavailable'),
				backed_off: true,
				delivery_started_at: null,
			},
		]);
		guild.channels.cache.set(channelId, channel);
		await makeDue();
		await instance.reconcile();
		expect(messages()).toEqual([
			'New puzzle unlocked in round "Round": "Puzzle".',
		]);
	});

	it('retries partially completed tombstone deletion idempotently', async () => {
		await worker().reconcile();
		const puzzle = (await database.store.read(scope)).document.nodes[
			puzzleId
		];
		await submit({ type: 'delete', nodeId: puzzleId });
		const guild = discord.getGuild();
		const remove = guild.channels.delete.bind(guild.channels);
		vi.spyOn(guild.channels, 'delete')
			.mockRejectedValueOnce(new Error('Channel deletion unavailable'))
			.mockImplementation(remove);
		await worker().reconcile();
		expect(
			discord.serverState.roles.some(
				(value) => value.id === puzzle.discord!.roleId
			)
		).toBe(false);
		expect(
			discord.serverState.channels.some(
				(value) => value.id === puzzle.discord!.channelId
			)
		).toBe(true);
		await makeDue();
		await worker().reconcile();
		expect(
			discord.serverState.channels.some(
				(value) => value.id === puzzle.discord!.channelId
			)
		).toBe(false);
		expect(
			(
				await database.pool.query(
					'SELECT * FROM integration_events WHERE delivered_at IS NULL'
				)
			).rows
		).toEqual([]);
	});

	it('reconciles derived state after completed jobs, including old/new parent embeds and descendant permissions', async () => {
		await worker().reconcile();
		const secondId = crypto.randomUUID();
		await submit({
			type: 'add',
			nodes: [{ id: secondId, type: 'round', name: 'Second', url: '' }],
		});
		await worker().reconcile();
		await submit({ type: 'move', nodeId: roundId, parentId: secondId });
		await submit({
			type: 'set-property',
			nodeId: puzzleId,
			property: 'name',
			value: 'Renamed',
		});
		// Simulate completed desired work with no derived-sync hint surviving the crash.
		const owner = await own();
		for (const job of await owner.dueJobs())
			await integrations.completeWork(scope, job.id);
		await owner.release();
		await worker().reconcile();
		const snapshot = await database.store.read(scope);
		const puzzle = snapshot.document.nodes[puzzleId];
		const channel = discord.serverState.findChannelBy(
			'id',
			puzzle.discord!.channelId
		);
		expect(channel.name).toBe('renamed');
		const allowed = channel
			.permission_overwrites!.filter(
				(entry) =>
					BigInt(entry.allow) & PermissionsBitField.Flags.ViewChannel
			)
			.map((entry) => entry.id);
		expect(allowed).toContain(
			snapshot.document.nodes[secondId].discord!.roleId
		);
		expect(allowed).not.toContain(
			snapshot.document.nodes[rootId].discord!.roleId
		);
		const embeds = (id: string) =>
			JSON.stringify(
				discord.serverState.messages.get(
					snapshot.document.nodes[id].discord!.indexChannelId!
				)
			);
		expect(embeds(roundId)).toContain(
			`<#${snapshot.document.nodes[secondId].discord!.indexChannelId}>`
		);
		await submit({ type: 'move', nodeId: puzzleId, parentId: secondId });
		await worker().reconcile();
		expect(
			discord.serverState.findChannelBy('id', puzzle.discord!.channelId)
				.parent_id
		).toBe(snapshot.document.nodes[secondId].discord!.channelId);
		expect(embeds(secondId)).toContain('Renamed');
		expect(embeds(roundId)).not.toContain('Renamed');
		expect(createSheet).toHaveBeenCalledTimes(1);
	});
});

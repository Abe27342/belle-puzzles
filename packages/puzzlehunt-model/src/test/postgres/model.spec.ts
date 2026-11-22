import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PuzzlehuntModel } from '../../model/puzzlehunt.js';
import { PostgresHuntIntegrationStore } from '../../postgres/integration-store.js';
import { comparableView, puzzlehuntModelContract } from '../model/contract.js';
import { startLocalPostgres } from '../fixtures/postgres.js';
import { snowflake } from '../../document.js';

let database: Awaited<ReturnType<typeof startLocalPostgres>>;
beforeAll(async () => {
	database = await startLocalPostgres();
}, 60000);
afterAll(async () => {
	await database?.close();
}, 30000);

puzzlehuntModelContract(
	'PostgreSQL model against a disposable local database',
	async () => {
		await database.reset();
		const scope = await database.store.create(snowflake('contract-guild'), {
			name: 'Contract test hunt',
		});
		const model = await PuzzlehuntModel.load(database.store, scope);
		const hunts = new Map([
			['Contract test hunt', { scope, models: [model] }],
		]);
		return {
			model,
			async createModel(huntName = 'Contract test hunt') {
				const hunt = hunts.get(huntName);
				if (hunt === undefined) {
					throw new Error(`Unknown hunt: ${huntName}`);
				}
				const connected = await PuzzlehuntModel.load(
					database.store,
					hunt.scope
				);
				hunt.models.push(connected);
				return connected;
			},
			async createHunt(huntName) {
				if (hunts.has(huntName)) {
					throw new Error(`Hunt already exists: ${huntName}`);
				}
				const independentScope = await database.store.create(
					scope.guildId,
					{ name: huntName }
				);
				const independent = await PuzzlehuntModel.load(
					database.store,
					independentScope
				);
				hunts.set(huntName, {
					scope: independentScope,
					models: [independent],
				});
				return independent;
			},
			async synchronize(huntName = 'Contract test hunt') {
				const hunt = hunts.get(huntName);
				if (hunt === undefined) {
					throw new Error(`Unknown hunt: ${huntName}`);
				}
				await Promise.all(hunt.models.map((model) => model.flush()));
				await Promise.all(hunt.models.map((model) => model.refresh()));
				for (const other of hunt.models) {
					expect(comparableView(other.view)).toEqual(
						comparableView(hunt.models[0].view)
					);
				}
			},
			async close() {
				await Promise.all(
					[...hunts.values()].flatMap(({ models }) =>
						models.map((model) => model.flush())
					)
				);
			},
		};
	}
);

describe('PostgreSQL model provisioning results', () => {
	async function fixture() {
		await database.reset();
		const scope = await database.store.create(
			snowflake('integration-guild'),
			{ name: 'Contract test hunt' }
		);
		const integrations = new PostgresHuntIntegrationStore(database.pool);
		const model = await PuzzlehuntModel.load(
			database.store,
			scope,
			integrations
		);
		const round = model.addRound('Round', '');
		const puzzle = model.addPuzzle('Puzzle', '', round);
		await model.flush();
		const { rows: tasks } = await database.pool.query<{
			id: string;
			node_id: string;
			target: string;
		}>(
			'SELECT id, node_id, target FROM integration_jobs WHERE hunt_id = $1',
			[scope.huntId]
		);
		return {
			scope,
			integrations,
			model,
			round,
			puzzle,
			taskId(nodeId: string, target: 'discord' | 'google') {
				const task = tasks.find(
					(task) => task.node_id === nodeId && task.target === target
				);
				if (task === undefined) {
					throw new Error('Expected provisioning task.');
				}
				return task.id;
			},
		};
	}

	it('persists associations and completes their tasks through the shared model', async () => {
		const { model, scope, round, puzzle, taskId } = await fixture();
		model.augmentWithDiscord(
			round,
			{
				channel: { id: 'category' },
				role: 'round-role',
				indexChannel: 'index',
			},
			taskId(round.id, 'discord')
		);
		model.augmentWithDiscord(
			puzzle,
			{ channel: 'channel', role: { id: 'puzzle-role' } },
			taskId(puzzle.id, 'discord')
		);
		model.augmentWithGoogleSheet(
			puzzle,
			'sheet',
			taskId(puzzle.id, 'google')
		);
		expect(model.isPending).toBe(true);
		await model.flush();
		const reloaded = await PuzzlehuntModel.load(database.store, scope);
		expect(reloaded.getRound(round.id).discord).toEqual({
			channelId: 'category',
			roleId: 'round-role',
			indexChannelId: 'index',
		});
		expect(reloaded.getPuzzle(puzzle.id)).toMatchObject({
			discord: { channelId: 'channel', roleId: 'puzzle-role' },
			sheetId: 'sheet',
		});
		const { rows } = await database.pool.query<{
			completed: boolean;
		}>(
			'SELECT completed_at IS NOT NULL AS completed FROM integration_jobs WHERE hunt_id = $1',
			[scope.huntId]
		);
		expect(rows).toEqual([
			{ completed: true },
			{ completed: true },
			{ completed: true },
		]);
	});

	it('rejects a stale result rather than attaching it to a replacement node', async () => {
		const { model, scope, round, puzzle, taskId } = await fixture();
		const staleTaskId = taskId(puzzle.id, 'discord');
		model.delete(puzzle);
		await model.flush();
		model.dispatch({
			type: 'add',
			nodes: [
				{
					id: puzzle.id,
					type: 'puzzle',
					name: 'Replacement',
					url: '',
					parentId: round.id,
				},
			],
		});
		await model.flush();
		model.augmentWithDiscord(
			puzzle,
			{ channel: 'old-channel', role: 'old-role' },
			staleTaskId
		);
		await expect(model.flush()).rejects.toBeInstanceOf(AggregateError);
		expect(model.getPuzzle(puzzle.id).name).toBe('Replacement');
		expect(model.getPuzzle(puzzle.id).discord).toBeUndefined();
		const { rows } = await database.pool.query(
			`SELECT completed_at IS NOT NULL AS completed, cancelled_at IS NOT NULL AS cancelled
			 FROM integration_jobs WHERE hunt_id = $1 AND id = $2`,
			[scope.huntId, staleTaskId]
		);
		expect(rows).toEqual([{ completed: false, cancelled: true }]);
	});

	it('retries an uncertain completion by task ID without overwriting newer state', async () => {
		const { model, scope, integrations, puzzle, taskId } = await fixture();
		const original = integrations.completeWork.bind(integrations);
		const complete = vi
			.spyOn(integrations, 'completeWork')
			.mockImplementationOnce(async (...args) => {
				await original(...args);
				throw new Error('Response lost after completion.');
			});
		const task = taskId(puzzle.id, 'google');
		model.augmentWithGoogleSheet(puzzle, 'first-sheet', task);
		await expect(model.flush()).rejects.toThrow('Response lost');
		expect(model.pendingChanges[0].status).toBe('uncertain');
		const other = await PuzzlehuntModel.load(database.store, scope);
		other.augmentWithGoogleSheet(other.getPuzzle(puzzle.id), 'later-sheet');
		await other.flush();
		await model.retryPending();
		expect(complete.mock.calls.map((call) => call[1])).toEqual([
			task,
			task,
		]);
		expect(model.getPuzzle(puzzle.id).sheetId).toBe('later-sheet');
		expect(model.committedSnapshot.revision).toBe(
			other.committedSnapshot.revision
		);
		expect(model.isPending).toBe(false);
		complete.mockRestore();
	});
});

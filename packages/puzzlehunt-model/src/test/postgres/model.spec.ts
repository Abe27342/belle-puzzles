import { afterAll, beforeAll, expect } from 'vitest';
import { PuzzlehuntModel } from '../../model/puzzlehunt.js';
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
		const scope = {
			huntId: crypto.randomUUID(),
			guildId: snowflake('contract-guild'),
		};
		await database.reset(scope);
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
				const independentScope = {
					...scope,
					huntId: crypto.randomUUID(),
				};
				await database.pool.query(
					`INSERT INTO hunts (id, guild_id, name, schema_version)
					 VALUES ($1, $2, $3, 1)`,
					[
						independentScope.huntId,
						independentScope.guildId,
						huntName,
					]
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

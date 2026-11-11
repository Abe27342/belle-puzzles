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
		const models = [model];
		const independentModels: PuzzlehuntModel[] = [];
		return {
			model,
			async connect() {
				const connected = await PuzzlehuntModel.load(
					database.store,
					scope
				);
				models.push(connected);
				return connected;
			},
			async createHunt() {
				const independentScope = {
					...scope,
					huntId: crypto.randomUUID(),
				};
				await database.pool.query(
					`INSERT INTO hunts (id, guild_id, name, schema_version)
					 VALUES ($1, $2, 'Independent hunt', 1)`,
					[independentScope.huntId, independentScope.guildId]
				);
				const independent = await PuzzlehuntModel.load(
					database.store,
					independentScope
				);
				independentModels.push(independent);
				return independent;
			},
			async synchronize() {
				const allModels = [...models, ...independentModels];
				await Promise.all(allModels.map((model) => model.flush()));
				await Promise.all(allModels.map((model) => model.refresh()));
				for (const other of models) {
					expect(comparableView(other.view)).toEqual(
						comparableView(model.view)
					);
				}
			},
			async close() {
				await Promise.all(
					[...models, ...independentModels].map((model) =>
						model.flush()
					)
				);
			},
		};
	}
);

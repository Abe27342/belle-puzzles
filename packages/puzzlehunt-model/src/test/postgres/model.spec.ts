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
			async synchronize() {
				await Promise.all(models.map((model) => model.flush()));
				await Promise.all(models.map((model) => model.refresh()));
				for (const other of models) {
					expect(comparableView(other.view)).toEqual(
						comparableView(model.view)
					);
				}
			},
			async close() {
				await Promise.all(models.map((model) => model.flush()));
			},
		};
	}
);

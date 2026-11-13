import { AzureClient } from '@fluidframework/azure-client';
import { InsecureTokenProvider } from '@fluidframework/test-client-utils';
import { expect, inject, vi } from 'vitest';
import {
	createNewPuzzlehunt,
	loadExistingPuzzlehunt,
} from '../../puzzlehunt.js';
import { FluidPuzzlehuntModel } from '../../fluid/model.js';
import { comparableView, puzzlehuntModelContract } from '../model/contract.js';
import { TestLogger } from '../utils.js';

puzzlehuntModelContract(
	'Fluid model against the local ordering service',
	async () => {
		const logger = new TestLogger();
		const client = () => {
			const user = {
				id: crypto.randomUUID(),
				name: 'Model contract test',
			};
			return new AzureClient({
				connection: {
					type: 'local',
					tokenProvider: new InsecureTokenProvider('', user),
					endpoint: inject('fluidEndpoint'),
				},
				logger,
			});
		};
		const initial = await createNewPuzzlehunt(client(), 'contract-guild');
		const model = new FluidPuzzlehuntModel(
			initial.puzzlehunt,
			initial.container
		);
		const sessions = [initial];
		const models = [model];
		const independentModels: FluidPuzzlehuntModel[] = [];
		const hunts = new Map([['Contract test hunt', initial.id]]);
		return {
			model,
			async createModel(huntName = 'Contract test hunt') {
				const id = hunts.get(huntName);
				if (id === undefined) {
					throw new Error(`Unknown hunt: ${huntName}`);
				}
				const session = await loadExistingPuzzlehunt(client(), id);
				sessions.push(session);
				const connected = new FluidPuzzlehuntModel(
					session.puzzlehunt,
					session.container
				);
				(id === initial.id ? models : independentModels).push(
					connected
				);
				return connected;
			},
			async createHunt(huntName) {
				if (hunts.has(huntName)) {
					throw new Error(`Hunt already exists: ${huntName}`);
				}
				const session = await createNewPuzzlehunt(
					client(),
					'contract-guild'
				);
				sessions.push(session);
				hunts.set(huntName, session.id);
				const independent = new FluidPuzzlehuntModel(
					session.puzzlehunt,
					session.container
				);
				independentModels.push(independent);
				return independent;
			},
			async synchronize() {
				await Promise.all(
					[...models, ...independentModels].map((model) =>
						model.flush()
					)
				);
				await vi.waitFor(
					() => {
						for (const other of models) {
							expect(comparableView(other.view)).toEqual(
								comparableView(model.view)
							);
						}
					},
					{ timeout: 10000, interval: 20 }
				);
			},
			async close() {
				sessions.forEach((session) => session.disposer.dispose());
				expect(logger.errorEvents).toEqual([]);
			},
		};
	}
);

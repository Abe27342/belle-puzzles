import { AzureClient } from '@fluidframework/azure-client';
import { InsecureTokenProvider } from '@fluidframework/test-client-utils';
import { expect, inject, vi } from 'vitest';
import {
	createNewPuzzlehunt,
	loadExistingPuzzlehunt,
} from '../../fluid/index.js';
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
		const model = initial.puzzlehunt;
		const sessions = [initial];
		const hunts = new Map([
			['Contract test hunt', { id: initial.id, models: [model] }],
		]);
		return {
			model,
			async createModel(huntName = 'Contract test hunt') {
				const hunt = hunts.get(huntName);
				if (hunt === undefined) {
					throw new Error(`Unknown hunt: ${huntName}`);
				}
				const session = await loadExistingPuzzlehunt(client(), hunt.id);
				sessions.push(session);
				const connected = session.puzzlehunt;
				hunt.models.push(connected);
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
				const independent = session.puzzlehunt;
				hunts.set(huntName, {
					id: session.id,
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
				await vi.waitFor(
					() => {
						for (const other of hunt.models) {
							expect(comparableView(other.view)).toEqual(
								comparableView(hunt.models[0].view)
							);
						}
					},
					{ timeout: 10000, interval: 20 }
				);
			},
			async close() {
				await Promise.all(sessions.map((session) => session.close()));
				expect(logger.errorEvents).toEqual([]);
			},
		};
	}
);

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
		return {
			model,
			async connect() {
				const session = await loadExistingPuzzlehunt(
					client(),
					initial.id
				);
				sessions.push(session);
				const connected = new FluidPuzzlehuntModel(
					session.puzzlehunt,
					session.container
				);
				models.push(connected);
				return connected;
			},
			async synchronize() {
				await Promise.all(models.map((model) => model.flush()));
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

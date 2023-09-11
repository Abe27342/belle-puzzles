import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { AzureClient } from '@fluidframework/azure-client';
import { InsecureTokenProvider } from '@fluidframework/test-client-utils';
import {
	createNewPuzzlehunt,
	createNewPuzzlehuntFromExisting,
	loadExistingPuzzlehunt,
} from '../puzzlehunt.js';
import { TestLogger } from './utils.js';

const guildId = 'mock-guild-id';
const user = {
	id: 'test user id',
	name: 'test user',
};

// Tests more interesting e2e scenarios involving creation/load rather than individual puzzlehunt functionality.
// Also serves as some sanity checks that AFR is working as intended.
describe('Puzzlehunts', () => {
	let logger: TestLogger;
	let client: AzureClient;
	let disposers: { dispose: () => void }[] = [];

	beforeEach(async () => {
		logger = new TestLogger();
		client = new AzureClient({
			connection: {
				type: 'local',
				tokenProvider: new InsecureTokenProvider('', user),
				endpoint: 'http://localhost:7070',
			},
			logger,
		});
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		disposers.forEach((disposer) => disposer.dispose());
		disposers = [];
		expect(logger.errorEvents).toEqual([]);
	});

	describe('can be created', () => {
		it('without logging info', async () => {
			const { puzzlehunt, disposer } = await createNewPuzzlehunt(
				client,
				guildId
			);
			disposers.push(disposer);
			expect(puzzlehunt.loggingChannelIds).toEqual(undefined);
		});

		it('with logging info', async () => {
			const { puzzlehunt, disposer } = await createNewPuzzlehunt(
				client,
				guildId,
				{
					puzzleAdd: 'add',
					puzzleSolve: 'solve',
					puzzleStatusUpdate: 'status',
				}
			);
			disposers.push(disposer);
			expect(puzzlehunt.loggingChannelIds).toEqual({
				puzzleAdd: 'add',
				puzzleSolve: 'solve',
				puzzleStatusUpdate: 'status',
			});
		});
	});

	it('can be loaded', async () => {
		const { puzzlehunt, disposer, id } = await createNewPuzzlehunt(
			client,
			guildId
		);
		disposers.push(disposer);
		const { puzzlehunt: puzzlehunt2, disposer: disposer2 } =
			await loadExistingPuzzlehunt(client, id);
		disposers.push(disposer2);
		const puzzlehunt2ChangedP = new Promise((resolve) => {
			puzzlehunt2.once('viewChange', resolve);
		});
		puzzlehunt.addRound('round 1', 'url 1');
		await puzzlehunt2ChangedP;
		expect(Array.from(puzzlehunt2.rounds)).toHaveLength(1);
		expect(Array.from(puzzlehunt2.rounds)[0].name).toEqual('round 1');
	});

	it('can be copied from an existing hunt', async () => {
		const { puzzlehunt, disposer } = await createNewPuzzlehunt(
			client,
			guildId
		);
		disposers.push(disposer);
		const round = puzzlehunt.addRound('round 1', 'url 1');
		puzzlehunt.addPuzzle('puzzle 2', 'url 2', round);
		const { puzzlehunt: puzzlehunt2, disposer: disposer2 } =
			await createNewPuzzlehuntFromExisting(client, puzzlehunt);
		disposers.push(disposer2);
		const rounds = Array.from(puzzlehunt2.rounds);
		expect(rounds).toHaveLength(1);
		expect(rounds[0].name).toEqual('round 1');
		const puzzles = Array.from(puzzlehunt2.puzzles);
		expect(puzzles).toHaveLength(1);
		expect(puzzles[0].name).toEqual('puzzle 2');
	});
});

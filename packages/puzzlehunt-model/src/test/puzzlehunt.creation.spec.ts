import { beforeEach, afterEach, describe, expect, inject, it, vi } from 'vitest';
import { AzureClient } from '@fluidframework/azure-client';
import { InsecureTokenProvider } from '@fluidframework/test-client-utils';
import {
	createNewPuzzlehunt,
	createNewPuzzlehuntFromExisting,
	loadExistingPuzzlehunt,
} from '../fluid/index.js';
import type { IPuzzlehuntSession } from '../model/types.js';
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
	let sessions: IPuzzlehuntSession[] = [];

	beforeEach(async () => {
		logger = new TestLogger();
		client = new AzureClient({
			connection: {
				type: 'local',
				tokenProvider: new InsecureTokenProvider('', user),
				endpoint: inject('fluidEndpoint'),
			},
			logger,
		});
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		sessions.forEach((session) => session.close());
		sessions = [];
		expect(logger.errorEvents).toEqual([]);
	});

	describe('can be created', () => {
		it('without logging info', async () => {
			const { session } = await createNewPuzzlehunt(client, guildId);
			sessions.push(session);
			const { puzzlehunt } = session;
			expect(puzzlehunt.loggingChannelIds).toEqual(undefined);
		});

		it('with logging info', async () => {
			const { session } = await createNewPuzzlehunt(client, guildId, {
				puzzleAdd: 'add',
				puzzleSolve: 'solve',
				puzzleStatusUpdate: 'status',
			});
			sessions.push(session);
			const { puzzlehunt } = session;
			expect(puzzlehunt.loggingChannelIds).toEqual({
				puzzleAdd: 'add',
				puzzleSolve: 'solve',
				puzzleStatusUpdate: 'status',
			});
		});
	});

	it('can be loaded', async () => {
		const { id, session } = await createNewPuzzlehunt(client, guildId);
		sessions.push(session);
		const { puzzlehunt } = session;
		const session2 = await loadExistingPuzzlehunt(client, id);
		sessions.push(session2);
		const { puzzlehunt: puzzlehunt2 } = session2;
		const puzzlehunt2ChangedP = new Promise((resolve) => {
			const unsubscribe = puzzlehunt2.subscribeChanges((event) => {
				unsubscribe();
				resolve(event);
			});
		});
		puzzlehunt.addRound('round 1', 'url 1');
		await puzzlehunt2ChangedP;
		expect(Array.from(puzzlehunt2.rounds)).toHaveLength(1);
		expect(Array.from(puzzlehunt2.rounds)[0].name).toEqual('round 1');
	});

	it('can be copied from an existing hunt', async () => {
		const { session } = await createNewPuzzlehunt(client, guildId);
		sessions.push(session);
		const { puzzlehunt } = session;
		const round = puzzlehunt.addRound('round 1', 'url 1');
		puzzlehunt.addPuzzle('puzzle 2', 'url 2', round);
		const { session: session2 } = await createNewPuzzlehuntFromExisting(
			client,
			puzzlehunt
		);
		sessions.push(session2);
		const { puzzlehunt: puzzlehunt2 } = session2;
		const rounds = Array.from(puzzlehunt2.rounds);
		expect(rounds).toHaveLength(1);
		expect(rounds[0].name).toEqual('round 1');
		const puzzles = Array.from(puzzlehunt2.puzzles);
		expect(puzzles).toHaveLength(1);
		expect(puzzles[0].name).toEqual('puzzle 2');
	});
});

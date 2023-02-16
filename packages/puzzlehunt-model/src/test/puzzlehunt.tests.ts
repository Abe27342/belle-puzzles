import { strict as assert } from 'assert';
import { AzureClient } from '@fluidframework/azure-client';
import { InsecureTokenProvider } from '@fluidframework/test-client-utils';
import { createNewPuzzlehunt, IPuzzlehunt } from '../puzzlehunt.js';
import {
	ITelemetryBaseEvent,
	ITelemetryBaseLogger,
} from '@fluidframework/common-definitions';

class TestLogger implements ITelemetryBaseLogger {
	public errorEvents: ITelemetryBaseEvent[] = [];
	public send(event: ITelemetryBaseEvent): void {
		if (event.category === 'error') {
			this.errorEvents.push(event);
		}
	}
}

const guildId = 'mock-guild-id';
const user = {
	id: 'test user id',
	name: 'test user',
};

describe('Puzzlehunt', () => {
	let puzzlehunt: IPuzzlehunt;
	let disposer: { dispose: () => void };
	let logger: TestLogger;

	beforeEach(async () => {
		logger = new TestLogger();
		const client = new AzureClient({
			connection: {
				type: 'local',
				tokenProvider: new InsecureTokenProvider('', user),
				endpoint: 'http://localhost:7070',
			},
			logger,
		});
		const results = await createNewPuzzlehunt(client, guildId);
		puzzlehunt = results.puzzlehunt;
		disposer = results.disposer;
	});

	afterEach(async () => {
		disposer.dispose();
		puzzlehunt = undefined;
		disposer = undefined;
		if (logger.errorEvents.length > 0) {
			assert.fail(
				`Unexpected error events during test execution: ${JSON.stringify(
					logger.errorEvents
				)}`
			);
		}
	});

	it('starts empty', () => {
		assert.deepEqual(Array.from(puzzlehunt.rounds), []);
		assert.deepEqual(Array.from(puzzlehunt.puzzles), []);
	});

	it('supports round addition', () => {
		const round = puzzlehunt.addRound('Test round 1', 'mock url');
		assert.deepEqual(round.children, []);
		assert.equal(round.name, 'Test round 1');
		assert.equal(round.url, 'mock url');
		const allRounds = Array.from(puzzlehunt.rounds);
		assert.equal(allRounds.length, 1);
		assert.equal(allRounds[0].id, round.id);
	});
});

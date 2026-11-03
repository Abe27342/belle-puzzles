import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	Change,
	SharedTree,
	StablePlace,
	TraitLabel,
} from '@fluid-experimental/tree';
import {
	createNewPuzzlehunt,
	loadExistingPuzzlehunt,
	snapshotPuzzlehunt,
} from '@belle-puzzles/puzzlehunt-model';
import {
	makeFluidClient,
	makeReadOnlyFluidConnection,
} from '../fluid/client.js';
import * as fluidClient from '../fluid/client.js';
import { loadSnapshot } from '../export/fluid.js';

describe('read-only Fluid export against the local relay', () => {
	const disposers: { dispose: () => void }[] = [];

	afterEach(() => {
		disposers.splice(0).forEach((disposer) => disposer.dispose());
		vi.restoreAllMocks();
	});

	it('uses read-only tokens without document or summarizer write permissions', async () => {
		const connection = makeReadOnlyFluidConnection();
		const { jwt } = await connection.tokenProvider.fetchStorageToken(
			'local',
			'example'
		);
		const claims = JSON.parse(
			Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8')
		);
		expect(claims.scopes).toEqual(['doc:read']);
	});

	it('catches up unsummarized operations and preserves nested order, identity and every logical field', async () => {
		expect(process.env.USE_LOCAL_SERVICE).toBeTruthy();
		const created = await createNewPuzzlehunt(makeFluidClient(), '1', {
			puzzleAdd: '10',
			puzzleSolve: '11',
			puzzleStatusUpdate: '12',
		});
		disposers.push(created.disposer);
		const { puzzlehunt: hunt, container, id } = created;
		const first = hunt.addRound('First', 'first-url');
		const second = hunt.addRound('Second', '');
		const puzzle = hunt.addPuzzle('Puzzle', 'puzzle-url', first);
		const nested = hunt.addRound('Nested', 'nested-url', first);
		hunt.addPuzzle('Absent optional fields', '', nested);
		hunt.augmentWithDiscord(first, {
			channel: '13',
			role: '14',
			indexChannel: '15',
		});
		hunt.augmentWithDiscord(puzzle, { channel: '16', role: '17' });
		hunt.augmentWithGoogleSheet(puzzle, '');
		hunt.solve(puzzle.id, '');
		const now = vi.spyOn(Date, 'now').mockReturnValue(0);
		hunt.updateStatus(puzzle, '');
		now.mockRestore();
		// Partial associations can exist between integration updates and must not disappear.
		const tree = container.initialObjects.hunt as SharedTree;
		tree.applyEdit(
			...Change.insertTree(
				{
					definition: '13574b71-cd65-4672-98bd-e0c045f04f6a',
					payload: '18',
				},
				StablePlace.atEndOf({
					parent: second.id,
					label: 'channelId' as TraitLabel,
				})
			)
		);
		if (container.isDirty) {
			await new Promise<void>((resolve) =>
				container.once('saved', resolve)
			);
		}
		const expected = snapshotPuzzlehunt(hunt);
		const changes = vi.fn();
		hunt.on('viewChange', changes);
		const editCount = tree.edits.length;
		const exported = await loadSnapshot(id);
		expect(exported.state).toEqual(expected);
		expect(exported.state.rootIds).toEqual([
			tree.convertToStableNodeId(first.id),
			tree.convertToStableNodeId(second.id),
		]);
		const [round, exportedPuzzle, subround, absent, partial] =
			exported.state.nodes;
		expect(round).toMatchObject({
			type: 'round',
			childIds: [exportedPuzzle.id, subround.id],
			discordInfo: {
				channelId: '13',
				roleId: '14',
				indexChannelId: '15',
			},
		});
		expect(exportedPuzzle).toEqual({
			id: tree.convertToStableNodeId(puzzle.id),
			parentId: round.id,
			type: 'puzzle',
			name: 'Puzzle',
			url: 'puzzle-url',
			discordInfo: { channelId: '16', roleId: '17' },
			sheetId: '',
			answer: '',
			status: '',
			lastStatusUpdate: 0,
		});
		expect(subround).toMatchObject({
			type: 'round',
			childIds: [absent.id],
			parentId: round.id,
		});
		expect(absent).not.toHaveProperty('answer');
		expect(absent).not.toHaveProperty('status');
		expect(absent).not.toHaveProperty('lastStatusUpdate');
		expect(absent).not.toHaveProperty('sheetId');
		expect(partial).toMatchObject({ discordInfo: { channelId: '18' } });
		expect(JSON.parse(JSON.stringify(exported.state))).toEqual(
			exported.state
		);
		expect(tree.edits.length).toBe(editCount);
		expect(changes).not.toHaveBeenCalled();
		expect(container.isDirty).toBe(false);

		const fresh = await loadSnapshot(id);
		expect(fresh.state).toEqual(expected);
	});

	it('exports an empty document without inventing optional logging configuration', async () => {
		const created = await createNewPuzzlehunt(makeFluidClient(), '2');
		disposers.push(created.disposer);
		const result = await loadSnapshot(created.id);
		expect(result.state).toEqual({ guildId: '2', rootIds: [], nodes: [] });
	});

	it('rejects an already-aborted load before opening the document', async () => {
		const client = makeFluidClient({ readOnly: true });
		const get = vi.spyOn(client, 'getContainer');
		const controller = new AbortController();
		controller.abort();
		await expect(
			loadExistingPuzzlehunt(client, 'unused', {
				signal: controller.signal,
			})
		).rejects.toThrow();
		expect(get).not.toHaveBeenCalled();
	});

	it('disposes the loaded container when additional catch-up fails', async () => {
		const created = await createNewPuzzlehunt(makeFluidClient(), '3');
		disposers.push(created.disposer);
		let closed: boolean;
		await expect(
			loadExistingPuzzlehunt(
				makeFluidClient({ readOnly: true }),
				created.id,
				{
					catchUp: async (container) => {
						container.once('closed', () => {
							closed = true;
						});
						throw new Error('Delta storage unavailable');
					},
				}
			)
		).rejects.toThrow('Delta storage unavailable');
		expect(closed).toBe(true);
	});

	it('fails a timed-out load and disposes a container that arrives afterward', async () => {
		const created = await createNewPuzzlehunt(makeFluidClient(), '4');
		disposers.push(created.disposer);
		const client = makeFluidClient({ readOnly: true });
		const originalGet = client.getContainer.bind(client);
		let closed = false;
		vi.spyOn(client, 'getContainer').mockImplementation(async (...args) => {
			const result = await originalGet(...args);
			const dispose = result.container.dispose.bind(result.container);
			vi.spyOn(result.container, 'dispose').mockImplementation(() => {
				closed = true;
				dispose();
			});
			return result;
		});
		vi.spyOn(fluidClient, 'makeFluidClient').mockReturnValue(client);
		await expect(loadSnapshot(created.id, 1)).rejects.toThrow('timed out');
		await vi.waitFor(() => expect(closed).toBe(true));
	});
});

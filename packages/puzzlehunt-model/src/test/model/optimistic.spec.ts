import { describe, expect, it, vi } from 'vitest';
import {
	applyHuntCommand,
	HuntCommandError,
	snowflake,
} from '../../document.js';
import type {
	HuntCommandResult,
	HuntDocumentClient,
	HuntSnapshot,
} from '../../document.js';
import { PuzzlehuntModel } from '../../model/puzzlehunt.js';
import type { PendingHuntChange } from '../../model/puzzlehunt.js';
import type { PuzzlehuntChangeEvent } from '../../model/types.js';

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const rootId = id(2);
const puzzleId = id(3);

function initialSnapshot(): HuntSnapshot {
	return {
		huntId: id(1),
		guildId: snowflake('guild'),
		schemaVersion: 1,
		revision: 0,
		document: {
			name: 'Hunt',
			configuration: {},
			nodes: {
				[rootId]: {
					id: rootId,
					type: 'round',
					name: 'Root',
					url: '',
					parentId: undefined,
					position: 0,
				},
				[puzzleId]: {
					id: puzzleId,
					type: 'puzzle',
					name: 'Puzzle',
					url: '',
					parentId: rootId,
					position: 0,
				},
			},
		},
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

/** Transport-only fixture; domain/SQL correctness is evaluated separately on services. */
function transport() {
	let snapshot = initialSnapshot();
	const receipts = new Map<string, number>();
	function commit(request: PendingHuntChange['request']): HuntCommandResult {
		let revision = receipts.get(request.commandId);
		const replayed = revision !== undefined;
		if (!replayed) {
			snapshot = {
				...snapshot,
				revision: snapshot.revision + 1,
				document: applyHuntCommand(
					snapshot.document,
					request.command,
					1234
				).document,
			};
			revision = snapshot.revision;
			receipts.set(request.commandId, revision);
		}
		if (revision === undefined) {
			throw new Error('Test receipt was not recorded.');
		}
		return {
			snapshot,
			replayed,
			receipt: {
				commandId: request.commandId,
				committedRevision: revision,
			},
		};
	}
	const client = {
		read: vi.fn<HuntDocumentClient['read']>(async () => snapshot),
		submit: vi.fn<HuntDocumentClient['submit']>(async (_scope, request) =>
			commit(request)
		),
	};
	return {
		client,
		commit,
		snapshot: () => snapshot,
		replace: (value: HuntSnapshot) => {
			snapshot = value;
		},
	};
}

describe('Optimistic puzzlehunt model', () => {
	it('requires a task and trusted capability before projecting provisioning results', () => {
		const backend = transport();
		const model = new PuzzlehuntModel(backend.client, backend.snapshot());
		const puzzle = model.getPuzzle(puzzleId);
		const association = { channel: 'channel', role: { id: 'role' } };
		expect(() => model.augmentWithDiscord(puzzle, association)).toThrow(
			'durable provisioning task ID'
		);
		expect(() =>
			model.augmentWithDiscord(puzzle, association, id(10))
		).toThrow('trusted integration client');
		expect(() =>
			model.augmentWithGoogleSheet(puzzle, 'sheet', id(10))
		).toThrow('trusted integration client');
		expect(model.getPuzzle(puzzleId)).toEqual(puzzle);
		expect(model.isPending).toBe(false);
		expect(backend.client.submit).not.toHaveBeenCalled();
	});

	it('rolls back rejected logging configuration without node change events', async () => {
		const backend = transport();
		backend.client.submit.mockRejectedValueOnce(
			new HuntCommandError('forbidden', 'Rejected.')
		);
		const model = new PuzzlehuntModel(backend.client, backend.snapshot());
		const changes = vi.fn();
		model.subscribeChanges(changes);
		model.setLoggingChannelIds({
			puzzleAdd: 'add',
			puzzleSolve: 'solve',
			puzzleStatusUpdate: 'status',
		});
		expect(model.loggingChannelIds?.puzzleAdd).toBe('add');
		await expect(model.flush()).rejects.toBeInstanceOf(AggregateError);
		expect(model.loggingChannelIds).toBeUndefined();
		expect(changes).not.toHaveBeenCalled();
	});

	it('preserves newer unrelated configuration when setting logging channels', async () => {
		const backend = transport();
		const initial = backend.snapshot();
		const model = new PuzzlehuntModel(backend.client, initial);
		backend.replace({
			...initial,
			revision: 1,
			document: {
				...initial.document,
				configuration: { googleFolderId: 'new-folder' },
			},
		});
		const ids = {
			puzzleAdd: 'add',
			puzzleSolve: 'solve',
			puzzleStatusUpdate: 'status',
		};
		model.setLoggingChannelIds(ids);
		await model.flush();
		expect(model.committedSnapshot.document.configuration).toEqual({
			googleFolderId: 'new-folder',
			loggingChannelIds: ids,
		});
	});

	it('batches every domain node of an authoritative added subtree', async () => {
		const backend = transport();
		const initial = backend.snapshot();
		const model = new PuzzlehuntModel(backend.client, {
			...initial,
			document: { ...initial.document, nodes: {} },
		});
		const listener = vi.fn<(event: PuzzlehuntChangeEvent) => void>();
		model.subscribeChanges(listener);
		backend.replace({ ...initial, revision: 1 });
		await model.refresh();
		expect(listener).toHaveBeenCalledOnce();
		const event = listener.mock.calls[0][0];
		expect(event.changes).toEqual([
			{ type: 'node-added', node: initial.document.nodes[rootId] },
			{ type: 'node-added', node: initial.document.nodes[puzzleId] },
		]);
		expect(event.before).toEqual({ rounds: [], puzzles: [] });
		expect(event.after.rounds[0].children[0].id).toBe(puzzleId);
	});

	it('observes authoritative reordering and Discord associations in one normalized batch', async () => {
		const backend = transport();
		const model = new PuzzlehuntModel(backend.client, backend.snapshot());
		const sibling = model.addPuzzle('Sibling', '', model.getRound(rootId));
		await model.flush();
		const before = backend.snapshot();
		const puzzle = model.getPuzzle(puzzleId);
		const siblingBefore = model.getPuzzle(sibling.id);
		const events: PuzzlehuntChangeEvent[] = [];
		model.subscribeChanges((event) => events.push(event));
		backend.replace({
			...before,
			revision: before.revision + 1,
			document: {
				...before.document,
				nodes: {
					...before.document.nodes,
					[puzzleId]: {
						...puzzle,
						position: 1,
						discord: {
							channelId: snowflake('channel'),
							roleId: snowflake('role'),
						},
					},
					[sibling.id]: { ...siblingBefore, position: 0 },
				},
			},
		});
		await model.refresh();
		expect(events).toHaveLength(1);
		expect(events[0].changes).toHaveLength(2);
		expect(events[0].changes[0]).toMatchObject({
			type: 'node-changed',
			before: { id: puzzleId, position: 0 },
			after: {
				id: puzzleId,
				position: 1,
				discord: { channelId: 'channel', roleId: 'role' },
			},
		});
		expect(
			events[0].before.rounds[0].children.map((node) => node.id)
		).toEqual([puzzleId, sibling.id]);
		expect(
			events[0].after.rounds[0].children.map((node) => node.id)
		).toEqual([sibling.id, puzzleId]);
	});

	it('separates visible transitions from acknowledgement, uncertainty and error invalidations', async () => {
		const backend = transport();
		backend.client.submit.mockRejectedValueOnce(new Error('Uncertain.'));
		const model = new PuzzlehuntModel(backend.client, backend.snapshot());
		const changes = vi.fn();
		const invalidations = vi.fn();
		model.subscribeChanges(changes);
		model.subscribe(invalidations);
		model.changeName(model.getPuzzle(puzzleId), 'Optimistic');
		await expect(model.flush()).rejects.toThrow('Uncertain.');
		expect(changes).toHaveBeenCalledOnce();
		expect(invalidations).toHaveBeenCalledTimes(2);
		await model.retryPending();
		model.clearFailures();
		expect(changes).toHaveBeenCalledOnce();
		expect(invalidations).toHaveBeenCalledTimes(4);
	});

	it('does not repeat root changes when JSON acknowledgements omit undefined parent IDs', async () => {
		const backend = transport();
		backend.client.submit.mockImplementation(async (_scope, request) =>
			JSON.parse(JSON.stringify(backend.commit(request)))
		);
		const model = new PuzzlehuntModel(backend.client, backend.snapshot());
		const listener = vi.fn();
		model.subscribeChanges(listener);
		const round = model.addRound('New root', '');
		expect(listener).toHaveBeenCalledOnce();
		await model.flush();
		expect(model.getRound(round.id).parentId).toBeUndefined();
		expect(listener).toHaveBeenCalledOnce();
		await model.refresh();
		expect(listener).toHaveBeenCalledOnce();
	});

	it('batches rollback of rejected subtrees without altering retained event snapshots', async () => {
		const backend = transport();
		backend.client.submit.mockRejectedValueOnce(
			new HuntCommandError('conflict', 'Rejected.')
		);
		const model = new PuzzlehuntModel(backend.client, backend.snapshot());
		const events: PuzzlehuntChangeEvent[] = [];
		model.subscribeChanges((event) => events.push(event));
		const round = model.addRound('Rejected', '');
		const puzzle = model.addPuzzle('Dependent', '', round);
		const saved = JSON.stringify(events);
		await expect(model.flush()).rejects.toBeInstanceOf(AggregateError);
		expect(events).toHaveLength(3);
		expect(events[2].changes).toEqual([
			{
				type: 'node-removed',
				node: expect.objectContaining({ id: round.id }),
			},
			{
				type: 'node-removed',
				node: expect.objectContaining({ id: puzzle.id }),
			},
		]);
		expect(JSON.stringify(events.slice(0, 2))).toBe(saved);
	});

	it('publishes authoritative rebase corrections as one transition per affected node', async () => {
		const backend = transport();
		const model = new PuzzlehuntModel(backend.client, backend.snapshot());
		const events: PuzzlehuntChangeEvent[] = [];
		model.subscribeChanges((event) => events.push(event));
		model.updateStatus(model.getPuzzle(puzzleId), 'Working');
		await model.flush();
		expect(events).toHaveLength(2);
		expect(events[0].changes).toHaveLength(1);
		expect(events[1].changes).toHaveLength(1);
		expect(events[1].changes[0]).toMatchObject({
			type: 'node-changed',
			before: { status: 'Working' },
			after: { status: 'Working', lastStatusUpdate: 1234 },
		});
	});

	it('coalesces repeated refresh requests behind an uncertain command', async () => {
		const backend = transport();
		backend.client.submit.mockRejectedValueOnce(new Error('Uncertain.'));
		const model = new PuzzlehuntModel(backend.client, backend.snapshot());
		model.changeName(model.getPuzzle(puzzleId), 'Changed');
		await expect(model.flush()).rejects.toThrow('Uncertain.');
		await Promise.allSettled(
			Array.from({ length: 100 }, () => model.refresh())
		);
		expect(backend.client.read).not.toHaveBeenCalled();
		await model.retryPending();
		expect(backend.client.read).toHaveBeenCalledOnce();
	});

	it('skips a notified revision already covered by a command acknowledgement', async () => {
		const backend = transport();
		const first = deferred<HuntCommandResult>();
		backend.client.submit.mockImplementationOnce(() => first.promise);
		const model = new PuzzlehuntModel(backend.client, backend.snapshot());
		model.changeName(model.getPuzzle(puzzleId), 'Changed');
		const refresh = model.refresh(1);
		await vi.waitFor(() =>
			expect(backend.client.submit).toHaveBeenCalledOnce()
		);
		first.resolve(backend.commit(model.pendingChanges[0].request));
		await refresh;
		expect(backend.client.read).not.toHaveBeenCalled();
	});

	it('shows pending changes synchronously but keeps committed state separate', async () => {
		const backend = transport();
		const response = deferred<HuntCommandResult>();
		backend.client.submit.mockImplementationOnce(() => response.promise);
		const model = new PuzzlehuntModel(backend.client, backend.snapshot());
		model.changeName(model.getPuzzle(puzzleId), 'Optimistic');
		expect(model.getPuzzle(puzzleId).name).toBe('Optimistic');
		expect(model.committedSnapshot.document.nodes[puzzleId].name).toBe(
			'Puzzle'
		);
		expect(model.pendingChanges).toHaveLength(1);
		await vi.waitFor(() =>
			expect(backend.client.submit).toHaveBeenCalledOnce()
		);
		response.resolve(backend.commit(model.pendingChanges[0].request));
		await model.flush();
		expect(model.committedSnapshot.document.nodes[puzzleId].name).toBe(
			'Optimistic'
		);
		expect(model.isPending).toBe(false);
	});

	it('serializes local commands and adopts authoritative status timestamps', async () => {
		const backend = transport();
		const model = new PuzzlehuntModel(backend.client, backend.snapshot());
		const round = model.addRound('New round', '');
		const puzzle = model.addPuzzle('New puzzle', '', round);
		model.updateStatus(puzzle, 'Working');
		expect(model.getPuzzle(puzzle.id).lastStatusUpdate).not.toBe(1234);
		await model.flush();
		expect(model.getPuzzle(puzzle.id).lastStatusUpdate).toBe(1234);
		expect(backend.client.submit).toHaveBeenCalledTimes(3);
		expect(model.committedSnapshot.revision).toBe(3);
	});

	it('rolls back a rejected add, fails dependent edits, and commits independent edits', async () => {
		const backend = transport();
		backend.client.submit.mockRejectedValueOnce(
			new HuntCommandError('conflict', 'Round creation rejected.')
		);
		const model = new PuzzlehuntModel(backend.client, backend.snapshot());
		const rejected = model.addRound('Rejected', '');
		model.addPuzzle('Dependent', '', rejected);
		model.changeName(model.getPuzzle(puzzleId), 'Independent');
		await expect(model.flush()).rejects.toBeInstanceOf(AggregateError);
		expect(model.rounds.map((node) => node.id)).toEqual([rootId]);
		expect(model.puzzles.map((node) => node.name)).toEqual(['Independent']);
		expect(model.failures).toHaveLength(2);
		expect(backend.client.submit).toHaveBeenCalledTimes(2);
		expect(model.isPending).toBe(false);
		model.clearFailures();
		expect(model.failures).toEqual([]);
	});

	it('keeps new commands projected while installing acknowledgements', async () => {
		const backend = transport();
		const first = deferred<HuntCommandResult>();
		backend.client.submit.mockImplementationOnce(() => first.promise);
		const model = new PuzzlehuntModel(backend.client, backend.snapshot());
		model.changeName(model.getPuzzle(puzzleId), 'Renamed');
		model.changeUrl(model.getPuzzle(puzzleId), 'new-url');
		await vi.waitFor(() =>
			expect(backend.client.submit).toHaveBeenCalledOnce()
		);
		first.resolve(backend.commit(model.pendingChanges[0].request));
		await model.flush();
		expect(model.getPuzzle(puzzleId)).toMatchObject({
			name: 'Renamed',
			url: 'new-url',
		});
		expect(model.failures).toEqual([]);
	});

	it('orders refreshes after in-flight writes rather than double-projecting an accepted add', async () => {
		const backend = transport();
		const first = deferred<HuntCommandResult>();
		backend.client.submit.mockImplementationOnce(() => first.promise);
		const model = new PuzzlehuntModel(backend.client, backend.snapshot());
		const round = model.addRound('Added once', '');
		await vi.waitFor(() =>
			expect(backend.client.submit).toHaveBeenCalledOnce()
		);
		const result = backend.commit(model.pendingChanges[0].request);
		const refresh = model.refresh();
		expect(backend.client.read).not.toHaveBeenCalled();
		first.resolve(result);
		await refresh;
		expect(backend.client.read).toHaveBeenCalledOnce();
		expect(
			model.rounds.filter((node) => node.id === round.id)
		).toHaveLength(1);
		expect(model.failures).toEqual([]);
	});

	it('rejects queued commands made impossible by newer authoritative state', async () => {
		const backend = transport();
		const first = deferred<HuntCommandResult>();
		backend.client.submit.mockImplementationOnce(() => first.promise);
		const model = new PuzzlehuntModel(backend.client, backend.snapshot());
		model.changeName(model.getRound(rootId), 'Renamed');
		model.addPuzzle('Now impossible', '', model.getRound(rootId));
		await vi.waitFor(() =>
			expect(backend.client.submit).toHaveBeenCalledOnce()
		);
		const committed = backend.commit(model.pendingChanges[0].request);
		backend.replace({
			...committed.snapshot,
			revision: committed.snapshot.revision + 1,
			document: applyHuntCommand(
				committed.snapshot.document,
				{ type: 'delete', nodeId: rootId },
				1235
			).document,
		});
		first.resolve({ ...committed, snapshot: backend.snapshot() });
		await expect(model.flush()).rejects.toBeInstanceOf(AggregateError);
		expect(model.puzzles).toEqual([]);
		expect(model.failures).toHaveLength(1);
		expect(backend.client.submit).toHaveBeenCalledOnce();
	});

	it('retains uncertain intent and retries the original ID without overwriting a later solve', async () => {
		const backend = transport();
		backend.client.submit.mockImplementationOnce(
			async (_scope, request) => {
				backend.commit(request);
				throw new Error('Response lost after commit.');
			}
		);
		const model = new PuzzlehuntModel(backend.client, backend.snapshot());
		model.solve(puzzleId, 'FIRST');
		const request = model.pendingChanges[0].request;
		await expect(model.flush()).rejects.toThrow('Response lost');
		expect(model.pendingChanges[0].status).toBe('uncertain');
		expect(model.pendingChanges[0].error?.message).toContain(
			'Response lost'
		);
		backend.commit({
			commandId: crypto.randomUUID(),
			command: {
				type: 'set-property',
				property: 'answer',
				nodeId: puzzleId,
				value: 'LATER',
			},
		});
		await model.retryPending();
		expect(backend.client.submit.mock.calls[1][1]).toEqual(request);
		expect(model.getPuzzle(puzzleId).answer).toBe('LATER');
		expect(model.isPending).toBe(false);
		expect(model.committedSnapshot.revision).toBe(2);
	});

	it('blocks queued dependent writes and refreshes behind an uncertain command', async () => {
		const backend = transport();
		backend.client.submit.mockRejectedValueOnce(
			new Error('Network failed.')
		);
		const model = new PuzzlehuntModel(backend.client, backend.snapshot());
		const round = model.addRound('Root', '');
		model.addPuzzle('Dependent', '', round);
		await expect(model.flush()).rejects.toThrow('Network failed');
		await expect(model.refresh()).rejects.toThrow('Network failed');
		expect(backend.client.read).not.toHaveBeenCalled();
		expect(backend.client.submit).toHaveBeenCalledOnce();
		await model.retryPending();
		expect(
			model.getRound(round.id).children.map((node) => node.name)
		).toEqual(['Dependent']);
		expect(backend.client.read).toHaveBeenCalledOnce();
	});

	it('does not replace committed state with an older refresh', async () => {
		const backend = transport();
		const model = new PuzzlehuntModel(backend.client, backend.snapshot());
		model.changeName(model.getPuzzle(puzzleId), 'Newer');
		await model.flush();
		backend.client.read.mockResolvedValueOnce(initialSnapshot());
		await model.refresh();
		expect(model.getPuzzle(puzzleId).name).toBe('Newer');
		expect(model.committedSnapshot.revision).toBe(1);
	});

	it('can retry from an uncertainty notification while the failed attempt unwinds', async () => {
		const backend = transport();
		backend.client.submit.mockRejectedValueOnce(
			new Error('Retry this attempt.')
		);
		const model = new PuzzlehuntModel(backend.client, backend.snapshot());
		let recovery: Promise<void> | undefined;
		model.subscribe(() => {
			if (model.pendingChanges[0]?.status === 'uncertain' && !recovery) {
				recovery = model.retryPending();
			}
		});
		model.solve(puzzleId, 'RECOVERED');
		await expect(model.flush()).rejects.toThrow('Retry this attempt');
		await recovery;
		expect(model.getPuzzle(puzzleId).answer).toBe('RECOVERED');
		expect(model.isPending).toBe(false);
		expect(backend.client.submit).toHaveBeenCalledTimes(2);
	});

	it('rejects cross-scope loads and refreshes explicitly', async () => {
		const backend = transport();
		const model = new PuzzlehuntModel(backend.client, backend.snapshot());
		backend.client.read.mockResolvedValue({
			...backend.snapshot(),
			guildId: snowflake('different-guild'),
		});
		await expect(
			PuzzlehuntModel.load(backend.client, backend.snapshot())
		).rejects.toThrow('different scope');
		await expect(model.refresh()).rejects.toBeInstanceOf(AggregateError);
		expect(model.failures[0].error.message).toContain('scope');
		expect(model.committedSnapshot.guildId).toBe(snowflake('guild'));
	});

	it('keeps malformed acknowledgements uncertain instead of dropping the command', async () => {
		const backend = transport();
		backend.client.submit.mockImplementationOnce(
			async (_scope, request) => ({
				...backend.commit(request),
				receipt: {
					commandId: crypto.randomUUID(),
					committedRevision: 1,
				},
			})
		);
		const model = new PuzzlehuntModel(backend.client, backend.snapshot());
		model.solve(puzzleId, 'ANSWER');
		await expect(model.flush()).rejects.toThrow('acknowledgement');
		expect(model.pendingChanges[0].status).toBe('uncertain');
		await model.retryPending();
		expect(model.getPuzzle(puzzleId).answer).toBe('ANSWER');
		expect(model.committedSnapshot.revision).toBe(1);
	});

	it('rejects invalid local commands before enqueueing or contacting the service', () => {
		const backend = transport();
		const model = new PuzzlehuntModel(backend.client, backend.snapshot());
		expect(() =>
			model.dispatch({
				type: 'move',
				nodeId: rootId,
				parentId: rootId,
			})
		).toThrow(HuntCommandError);
		expect(backend.client.submit).not.toHaveBeenCalled();
		expect(model.isPending).toBe(false);
	});
});

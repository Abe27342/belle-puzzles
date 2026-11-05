import { describe, expect, it, vi } from 'vitest';
import {
	applyHuntStateUpdate,
	HuntCommandError,
	snowflake,
} from '../../document.js';
import type { DocumentRound, HuntDelta, HuntSnapshot } from '../../document.js';
import { HttpHuntDocumentClient } from '../../http/client.js';
import {
	decodeHuntRevision,
	decodeHuntStateUpdate,
	HuntProtocolError,
} from '../../http/protocol.js';
import { PuzzlehuntModel } from '../../model/puzzlehunt.js';

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = { huntId: id(1), guildId: snowflake('guild') };
const root: DocumentRound = {
	id: id(2),
	type: 'round',
	name: 'Root',
	url: '',
	parentId: null,
	position: 0,
};
const base: HuntSnapshot = {
	...scope,
	schemaVersion: 1,
	revision: 1,
	name: 'Hunt',
	configuration: {},
	document: { nodes: { [root.id]: root } },
};
const delta: HuntDelta = {
	...scope,
	schemaVersion: 1,
	baseRevision: 1,
	revision: 3,
	name: 'Renamed hunt',
	configuration: { indexId: snowflake('index') },
	upsertNodes: [{ ...root, name: 'Renamed root' }],
	deletedNodeIds: [],
};
const json = (value: unknown) =>
	new Response(JSON.stringify(value), {
		headers: { 'Content-Type': 'application/json' },
	});

describe('Incremental HTTP state', () => {
	it('keeps a failed post-acknowledgement recovery read uncertain', async () => {
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockResolvedValueOnce(json(base));
		const client = new HttpHuntDocumentClient({
			baseUrl: 'https://api.example.test',
			getToken: () => 'token',
			fetch,
		});
		const model = await PuzzlehuntModel.load(client, scope);
		fetch.mockImplementationOnce(async (_url, init) => {
			const request = JSON.parse(String(init?.body));
			return json({
				update: { type: 'delta', delta: { ...delta, baseRevision: 0 } },
				receipt: { commandId: request.commandId, committedRevision: 2 },
				replayed: false,
			});
		});
		fetch.mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					error: {
						code: 'not-found',
						message: 'Recovery read failed.',
					},
				}),
				{ status: 404, headers: { 'Content-Type': 'application/json' } }
			)
		);
		model.changeName(model.getRound(root.id), 'Pending');
		await expect(model.flush()).rejects.toBeInstanceOf(HuntProtocolError);
		expect(model.pendingChanges[0].status).toBe('uncertain');
		expect(
			fetch.mock.calls.filter((call) => call[1]?.method === 'POST')
		).toHaveLength(1);
	});

	it('assembles after-images without mutating committed base state', () => {
		const current = applyHuntStateUpdate(base, { type: 'delta', delta });
		expect(current.document.nodes[root.id].name).toBe('Renamed root');
		expect(current.name).toBe('Renamed hunt');
		expect(current.configuration.indexId).toBe('index');
		expect(base.document.nodes[root.id].name).toBe('Root');
	});

	it.each([
		{ ...delta, baseRevision: 0 },
		{ ...delta, guildId: 'other' },
		{ ...delta, revision: 0 },
		{ ...delta, deletedNodeIds: [root.id, root.id] },
		{ ...delta, deletedNodeIds: [root.id] },
		{ ...delta, upsertNodes: [root, root] },
		{
			...delta,
			upsertNodes: [
				{
					id: id(3),
					type: 'puzzle',
					parentId: id(9),
					name: 'Orphan',
					url: '',
					position: 0,
				},
			],
		},
	])('rejects an invalid base, scope, or graph %#', (bad) => {
		expect(() =>
			applyHuntStateUpdate(
				base,
				decodeHuntStateUpdate({ type: 'delta', delta: bad }, scope)
			)
		).toThrow();
	});

	it.each(['-1', '1.5', '01', '9007199254740992', '', ['1'], undefined])(
		'rejects an invalid read cursor %#',
		(value) => {
			expect(() => decodeHuntRevision(value)).toThrow(HuntCommandError);
		}
	);

	it('uses cached authoritative revision for reads and command acknowledgements', async () => {
		const fetch = vi.fn<typeof globalThis.fetch>();
		fetch.mockResolvedValueOnce(json(base));
		const client = new HttpHuntDocumentClient({
			baseUrl: 'https://api.example.test',
			getToken: () => 'token',
			fetch,
		});
		const model = await PuzzlehuntModel.load(client, scope);
		fetch.mockImplementationOnce(async (_url, init) => {
			const request = JSON.parse(String(init?.body));
			return json({
				update: { type: 'delta', delta },
				receipt: { commandId: request.commandId, committedRevision: 2 },
				replayed: false,
			});
		});
		model.changeName(model.getRound(root.id), 'Renamed root');
		await model.flush();
		expect(fetch.mock.calls[1][0]).toBe(
			`https://api.example.test/guilds/guild/hunts/${scope.huntId}/commands?since=1`
		);
		expect(
			JSON.parse(String(fetch.mock.calls[1][1]?.body))
		).not.toHaveProperty('since');
		expect(model.committedSnapshot.revision).toBe(3);
		fetch.mockResolvedValueOnce(
			json({
				type: 'delta',
				delta: {
					...delta,
					baseRevision: 3,
					revision: 4,
					upsertNodes: [],
					deletedNodeIds: [root.id],
				},
			})
		);
		await model.refresh();
		expect(fetch.mock.calls[2][0]).toContain('?since=3');
		expect(model.rounds).toEqual([]);
	});

	it('accepts explicit full fallback and recovers a mismatched delta base by read only', async () => {
		const fetch = vi.fn<typeof globalThis.fetch>();
		fetch.mockResolvedValueOnce(json(base));
		const client = new HttpHuntDocumentClient({
			baseUrl: 'https://api.example.test',
			getToken: () => 'token',
			fetch,
		});
		await client.read(scope);
		fetch.mockResolvedValueOnce(
			json({ type: 'snapshot', snapshot: { ...base, revision: 4 } })
		);
		expect((await client.read(scope)).revision).toBe(4);
		fetch.mockResolvedValueOnce(
			json({
				type: 'delta',
				delta: { ...delta, baseRevision: 1, revision: 5 },
			})
		);
		fetch.mockResolvedValueOnce(json({ ...base, revision: 5 }));
		expect((await client.read(scope)).revision).toBe(5);
		expect(fetch.mock.calls[3][0]).not.toContain('?since=');
		expect(
			fetch.mock.calls.every((call) => call[1]?.method === 'GET')
		).toBe(true);
	});

	it('keeps malformed delta acknowledgements uncertain instead of rolling back writes', async () => {
		const fetch = vi.fn<typeof globalThis.fetch>();
		fetch.mockResolvedValueOnce(json(base));
		const client = new HttpHuntDocumentClient({
			baseUrl: 'https://api.example.test',
			getToken: () => 'token',
			fetch,
		});
		const model = await PuzzlehuntModel.load(client, scope);
		fetch.mockImplementationOnce(async (_url, init) => {
			const request = JSON.parse(String(init?.body));
			return json({
				update: {
					type: 'delta',
					delta: { ...delta, upsertNodes: [root, root] },
				},
				receipt: { commandId: request.commandId, committedRevision: 2 },
				replayed: false,
			});
		});
		model.changeName(model.getRound(root.id), 'Pending');
		await expect(model.flush()).rejects.toBeInstanceOf(HuntProtocolError);
		expect(model.pendingChanges[0].status).toBe('uncertain');
		expect(model.getRound(root.id).name).toBe('Pending');
		expect(model.committedSnapshot.revision).toBe(1);
	});
});

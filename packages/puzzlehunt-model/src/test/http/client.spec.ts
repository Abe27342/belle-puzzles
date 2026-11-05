import { describe, expect, it, vi } from 'vitest';
import {
	applyHuntCommand,
	HuntCommandError,
	snowflake,
} from '../../document.js';
import type { HuntCommandRequest, HuntSnapshot } from '../../document.js';
import { HttpHuntDocumentClient, HuntHttpError } from '../../http/client.js';
import {
	decodeHuntCommandRequest,
	HuntProtocolError,
} from '../../http/protocol.js';
import { PuzzlehuntModel } from '../../model/puzzlehunt.js';

const scope = {
	huntId: '00000000-0000-4000-8000-000000000001',
	guildId: snowflake('guild'),
};
const snapshot: HuntSnapshot = {
	...scope,
	schemaVersion: 1,
	revision: 0,
	name: 'Hunt',
	configuration: {},
	document: { nodes: {} },
};
const json = (value: unknown, status = 200) =>
	new Response(JSON.stringify(value), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});

function transport() {
	const fetch = vi.fn<typeof globalThis.fetch>();
	const getToken = vi.fn(() => 'user-token');
	const client = new HttpHuntDocumentClient({
		baseUrl: 'https://api.example.test/api/',
		getToken,
		fetch,
	});
	return { fetch, getToken, client };
}

describe('HTTP hunt document client', () => {
	it('uses a distinct authorization scheme for trusted-service credentials', async () => {
		const fetch = vi.fn<typeof globalThis.fetch>(async () =>
			json(snapshot)
		);
		const client = new HttpHuntDocumentClient({
			baseUrl: 'https://api.example.test',
			getToken: () => 'service-token',
			authScheme: 'Service',
			fetch,
		});
		await client.read(scope);
		expect(fetch.mock.calls[0][1]?.headers).toMatchObject({
			Authorization: 'Service service-token',
		});
	});

	it('preserves a base path and obtains credentials for each uncached request', async () => {
		const { client, fetch, getToken } = transport();
		fetch.mockImplementation(async () => json(snapshot));
		await client.read(scope);
		getToken.mockReturnValue('replacement-token');
		await client.readActive(scope.guildId);
		expect(fetch.mock.calls[0][0]).toBe(
			`https://api.example.test/api/guilds/guild/hunts/${scope.huntId}`
		);
		expect(fetch.mock.calls[0][1]).toMatchObject({
			method: 'GET',
			headers: { Authorization: 'Bearer user-token' },
			cache: 'no-store',
			credentials: 'omit',
			redirect: 'error',
		});
		expect(fetch.mock.calls[1][0]).toBe(
			'https://api.example.test/api/guilds/guild/hunts/active'
		);
		expect(fetch.mock.calls[1][1]?.headers).toMatchObject({
			Authorization: 'Bearer replacement-token',
		});
	});

	it('sends the original command ID and only its intent', async () => {
		const { client, fetch } = transport();
		const request: HuntCommandRequest = {
			commandId: '00000000-0000-4000-8000-000000000002',
			command: {
				type: 'add',
				nodes: [
					{
						id: '00000000-0000-4000-8000-000000000003',
						type: 'round',
						name: 'Root',
						url: '',
						parentId: null,
					},
				],
			},
		};
		const result = {
			snapshot: { ...snapshot, revision: 1 },
			receipt: { commandId: request.commandId, committedRevision: 1 },
			replayed: false,
		};
		fetch.mockResolvedValue(json(result));
		expect(await client.submit(scope, request)).toEqual(result);
		expect(fetch.mock.calls[0][1]).toMatchObject({
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(request),
		});
	});

	it('rolls back an optimistic edit on an explicit authorization rejection', async () => {
		const { client, fetch } = transport();
		fetch.mockResolvedValue(
			json(
				{
					error: {
						code: 'forbidden',
						message: 'Membership required.',
					},
				},
				403
			)
		);
		const model = new PuzzlehuntModel(client, snapshot);
		model.addRound('Root', '');
		await expect(model.flush()).rejects.toThrow(
			'Puzzlehunt changes failed.'
		);
		expect(model.rounds).toHaveLength(0);
		expect(model.pendingChanges).toHaveLength(0);
		expect(model.failures[0].error).toBeInstanceOf(HuntCommandError);
	});

	it('retains the command and its ID after server uncertainty and retries explicitly', async () => {
		const { client, fetch } = transport();
		fetch.mockResolvedValueOnce(
			json(
				{
					error: {
						code: 'invalid-command',
						message: 'Not a valid rejection at 500.',
					},
				},
				500
			)
		);
		const model = new PuzzlehuntModel(client, snapshot);
		model.addRound('Root', '');
		await expect(model.flush()).rejects.toBeInstanceOf(HuntHttpError);
		expect(model.pendingChanges[0].status).toBe('uncertain');
		const originalBody = fetch.mock.calls[0][1]?.body;
		fetch.mockImplementationOnce(async (_url, init) => {
			const request = decodeHuntCommandRequest(
				JSON.parse(String(init?.body))
			);
			return json({
				snapshot: {
					...snapshot,
					revision: 1,
					document: applyHuntCommand(
						snapshot.document,
						request.command,
						1234
					).document,
				},
				receipt: { commandId: request.commandId, committedRevision: 1 },
				replayed: true,
			});
		});
		await model.retryPending();
		expect(fetch.mock.calls[1][1]?.body).toBe(originalBody);
		expect(model.pendingChanges).toHaveLength(0);
		expect(model.rounds).toHaveLength(1);
	});

	it.each([
		() => new Response('Gateway error', { status: 502 }),
		() => new Response('Not JSON', { status: 400 }),
		() =>
			json(
				{ error: { code: 'invalid-command', message: 'Wrong status' } },
				429
			),
		() => json({ ...snapshot, document: { nodes: [] } }),
		() => json({ ...snapshot, guildId: 'other' }),
	])(
		'never turns an untrusted failure or malformed response into a command rejection %#',
		async (response) => {
			const { client, fetch } = transport();
			fetch.mockResolvedValue(response());
			await expect(client.read(scope)).rejects.not.toBeInstanceOf(
				HuntCommandError
			);
		}
	);

	it('rejects active-hunt scope mismatches', async () => {
		const { client, fetch } = transport();
		fetch.mockResolvedValue(json({ ...snapshot, guildId: 'other' }));
		await expect(client.readActive(scope.guildId)).rejects.toBeInstanceOf(
			HuntProtocolError
		);
	});

	it('propagates network and credential-provider failures without retrying', async () => {
		const { client, fetch } = transport();
		const failure = new Error('Connection lost');
		fetch.mockRejectedValue(failure);
		await expect(client.read(scope)).rejects.toBe(failure);
		expect(fetch).toHaveBeenCalledTimes(1);
		const empty = new HttpHuntDocumentClient({
			baseUrl: 'https://api.example.test',
			getToken: () => '',
			fetch,
		});
		await expect(empty.read(scope)).rejects.toThrow(
			'No puzzlehunt API credential'
		);
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it('times out a request as uncertainty', async () => {
		const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
			const signal = init?.signal;
			if (!signal) {
				throw new Error('Expected a request cancellation signal.');
			}
			signal.throwIfAborted();
			return new Promise((_resolve, reject) => {
				signal.addEventListener('abort', () => reject(signal.reason));
			});
		});
		const client = new HttpHuntDocumentClient({
			baseUrl: 'https://api.example.test',
			getToken: () => 'token',
			fetch,
			timeoutMs: 5,
		});
		await expect(client.read(scope)).rejects.not.toBeInstanceOf(
			HuntCommandError
		);
		expect(fetch).toHaveBeenCalledTimes(1);
	});
});

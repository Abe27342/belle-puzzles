import { createServer } from 'node:http';
import type { Server } from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	HuntCommandError,
	snowflake,
} from '@belle-puzzles/puzzlehunt-model/document';
import type {
	HuntCommand,
	HuntSnapshot,
} from '@belle-puzzles/puzzlehunt-model/document';
import { createPuzzlehuntApp } from '../app.js';
import { HuntChangesUnavailableError } from '../changes.js';
import type { HuntChangeFeed } from '../changes.js';

const huntId = '00000000-0000-4000-8000-000000000001';
const nodeId = '00000000-0000-4000-8000-000000000003';
const snapshot: HuntSnapshot = {
	huntId,
	guildId: snowflake('guild'),
	schemaVersion: 1,
	revision: 1,
	document: { name: 'Hunt', configuration: {}, nodes: {} },
};
const servers: Server[] = [];
const controllers: AbortController[] = [];
const cleanups: (() => void)[] = [];
afterEach(async () => {
	for (const controller of controllers.splice(0)) controller.abort();
	for (const cleanup of cleanups.splice(0)) cleanup();
	await Promise.all(
		servers
			.splice(0)
			.map(
				(server) =>
					new Promise<void>((resolve, reject) =>
						server.close((error) =>
							error ? reject(error) : resolve()
						)
					)
			)
	);
});

async function fixture(mountPath?: string) {
	const listeners = new Set<{
		revision: (value: number) => void;
		disconnected: () => void;
	}>();
	const changes: HuntChangeFeed = {
		subscribe: vi.fn((_id, revision, disconnected) => {
			const listener = { revision, disconnected };
			listeners.add(listener);
			return () => listeners.delete(listener);
		}),
	};
	const disconnect = () => {
		for (const listener of [...listeners]) listener.disconnected();
	};
	cleanups.push(disconnect);
	const store = {
		create: vi.fn(async (_guildId, _request) => snapshot),
		list: vi.fn(async (guildId) => ({
			guildId: snowflake(guildId),
			hunts: [{ huntId, name: 'Hunt', active: true }],
		})),
		selectActive: vi.fn(async (_scope) => snapshot),
		read: vi.fn(async () => snapshot),
		readActive: vi.fn(async () => snapshot),
		readRevision: vi.fn(async () => snapshot.revision),
		readUpdates: vi.fn(async () => ({
			type: 'snapshot' as const,
			snapshot,
		})),
		submit: vi.fn(async (_scope, request) => ({
			snapshot,
			receipt: { commandId: request.commandId, committedRevision: 1 },
			replayed: false,
		})),
	};
	const authorize = vi.fn(
		async (_authorization: string | undefined, _guild: string) => {}
	);
	const onError = vi.fn();
	const app = createPuzzlehuntApp({
		store,
		changes,
		authorize,
		onError,
		allowedOrigins: ['https://allowed.test'],
	});
	const host =
		mountPath === undefined
			? app
			: express()
					.get('/bot-health', (_req, res) => res.json({ bot: true }))
					.use(mountPath, app);
	const server = createServer(host);
	servers.push(server);
	await new Promise<void>((resolve) =>
		server.listen(0, '127.0.0.1', resolve)
	);
	const address = server.address();
	if (!address || typeof address === 'string')
		throw new Error('Expected local port.');
	const url = `http://127.0.0.1:${address.port}${
		mountPath ?? ''
	}/guilds/guild/hunts/${huntId}`;
	const controller = new AbortController();
	controllers.push(controller);
	return {
		url,
		store,
		authorize,
		onError,
		changes,
		listeners,
		disconnect,
		controller,
	};
}

describe('Scoped SSE and synchronization routes (injected store)', () => {
	it('resolves active hunts before UUID routes and scopes full reads', async () => {
		const f = await fixture();
		expect(
			await (await fetch(f.url.replace(huntId, 'active'))).json()
		).toEqual(snapshot);
		expect(f.store.readActive).toHaveBeenCalledExactlyOnceWith('guild');
		expect(await (await fetch(f.url)).json()).toEqual(snapshot);
		expect(f.store.read).toHaveBeenCalledExactlyOnceWith({
			huntId,
			guildId: 'guild',
		});
	});

	it('mounts alongside bot routes on one HTTP server without changing authorization', async () => {
		const f = await fixture('/documents');
		const origin = new URL(f.url).origin;
		expect(await (await fetch(`${origin}/bot-health`)).json()).toEqual({
			bot: true,
		});
		expect(f.authorize).not.toHaveBeenCalled();
		expect(
			await (
				await fetch(f.url, {
					headers: { Authorization: 'Bearer test' },
				})
			).json()
		).toEqual(snapshot);
		expect(f.authorize).toHaveBeenCalledExactlyOnceWith(
			'Bearer test',
			'guild'
		);
		expect(f.store.read).toHaveBeenCalledExactlyOnceWith({
			huntId,
			guildId: 'guild',
		});
	});

	it.each([
		['', 'PUT', 'GET, HEAD, POST'],
		['active', 'POST', 'GET, HEAD, PUT'],
		[huntId, 'POST', 'GET, HEAD'],
		[`${huntId}/changes`, 'POST', 'GET, HEAD'],
		[`${huntId}/commands`, 'GET', 'POST'],
	])('retains the allowed methods for %s', async (path, method, allow) => {
		const f = await fixture();
		const response = await fetch(f.url.replace(huntId, path), { method });
		expect(response.status).toBe(405);
		expect(response.headers.get('allow')).toBe(allow);
		expect(f.authorize).toHaveBeenCalledOnce();
		expect(f.store.read).not.toHaveBeenCalled();
		expect(f.store.readActive).not.toHaveBeenCalled();
		expect(f.store.submit).not.toHaveBeenCalled();
		expect(f.store.create).not.toHaveBeenCalled();
		expect(f.store.selectActive).not.toHaveBeenCalled();
		expect(f.store.list).not.toHaveBeenCalled();
		expect(f.changes.subscribe).not.toHaveBeenCalled();
	});

	it('exposes guild-scoped creation, listing, and selection behind existing authorization', async () => {
		const f = await fixture('/documents');
		const collection = f.url.replace(`/${huntId}`, '');
		const request = {
			name: 'Next hunt',
			configuration: { googleFolderId: 'folder' },
		};
		const headers = {
			Authorization: 'Bearer test',
			'Content-Type': 'application/json',
		};
		const created = await fetch(collection, {
			method: 'POST',
			headers,
			body: JSON.stringify(request),
		});
		expect(created.status).toBe(201);
		expect(await created.json()).toEqual(snapshot);
		expect(f.store.create).toHaveBeenCalledExactlyOnceWith(
			'guild',
			request
		);
		const listed = await fetch(collection, { headers });
		expect(listed.status).toBe(200);
		expect(await listed.json()).toEqual({
			guildId: 'guild',
			hunts: [{ huntId, name: 'Hunt', active: true }],
		});
		expect(f.store.list).toHaveBeenCalledExactlyOnceWith('guild');
		const selected = await fetch(`${collection}/active`, {
			method: 'PUT',
			headers,
			body: JSON.stringify({ huntId }),
		});
		expect(selected.status).toBe(200);
		expect(await selected.json()).toEqual(snapshot);
		expect(f.store.selectActive).toHaveBeenCalledExactlyOnceWith({
			guildId: 'guild',
			huntId,
		});
		expect(f.authorize.mock.calls).toEqual([
			['Bearer test', 'guild'],
			['Bearer test', 'guild'],
			['Bearer test', 'guild'],
		]);
	});

	it.each([
		['POST', ''],
		['PUT', '/active'],
	] as const)(
		'authorizes %s lifecycle writes before body parsing',
		async (method, path) => {
			const f = await fixture();
			f.authorize.mockRejectedValueOnce(
				new HuntCommandError('forbidden', 'Not a guild member.')
			);
			const response = await fetch(f.url.replace(`/${huntId}`, path), {
				method,
				headers: { 'Content-Type': 'application/json' },
				body: '{',
			});
			expect(response.status).toBe(403);
			expect(f.store.create).not.toHaveBeenCalled();
			expect(f.store.selectActive).not.toHaveBeenCalled();
		}
	);

	it.each([
		['POST', '', { name: 'New', guildId: 'foreign' }],
		['POST', '', { name: ' ' }],
		['PUT', '/active', { huntId: 'invalid' }],
		['PUT', '/active', { huntId, guildId: 'foreign' }],
	] as const)(
		'rejects invalid %s lifecycle intent %#',
		async (method, path, body) => {
			const f = await fixture();
			const response = await fetch(f.url.replace(`/${huntId}`, path), {
				method,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			});
			expect(response.status).toBe(400);
			expect(f.store.create).not.toHaveBeenCalled();
			expect(f.store.selectActive).not.toHaveBeenCalled();
		}
	);

	it.each([
		['POST', '', 'text/plain', '{"name":"New"}', 415],
		['PUT', '/active', 'text/plain', JSON.stringify({ huntId }), 415],
		['POST', '', 'application/json', '{', 400],
		['PUT', '/active', 'application/json', '{', 400],
	] as const)(
		'rejects malformed or unsupported %s lifecycle bodies %#',
		async (method, path, contentType, body, status) => {
			const f = await fixture();
			const response = await fetch(f.url.replace(`/${huntId}`, path), {
				method,
				headers: { 'Content-Type': contentType },
				body,
			});
			expect(response.status).toBe(status);
			expect(await response.json()).toMatchObject({
				error: { code: 'invalid-command' },
			});
			expect(f.store.create).not.toHaveBeenCalled();
			expect(f.store.selectActive).not.toHaveBeenCalled();
		}
	);

	it('returns a scoped 404 on selection failure and allows authenticated PUT preflight', async () => {
		const f = await fixture();
		const active = f.url.replace(huntId, 'active');
		f.store.selectActive.mockRejectedValueOnce(
			new HuntCommandError('not-found', 'Hunt not found in this guild.')
		);
		const rejected = await fetch(active, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ huntId }),
		});
		expect(rejected.status).toBe(404);
		expect(await rejected.json()).toEqual({
			error: {
				code: 'not-found',
				message: 'Hunt not found in this guild.',
			},
		});
		const preflight = await fetch(active, {
			method: 'OPTIONS',
			headers: {
				Origin: 'https://allowed.test',
				'Access-Control-Request-Method': 'PUT',
			},
		});
		expect(preflight.status).toBe(204);
		expect(preflight.headers.get('access-control-allow-methods')).toContain(
			'PUT'
		);
	});

	it('authorizes commands before parsing invalid JSON', async () => {
		const f = await fixture();
		f.authorize.mockRejectedValueOnce(
			new HuntCommandError('unauthorized', 'Expired.')
		);
		const response = await fetch(`${f.url}/commands`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: '{',
		});
		expect(response.status).toBe(401);
		expect(response.headers.get('www-authenticate')).toBe(
			'Bearer, Service'
		);
		expect(f.store.submit).not.toHaveBeenCalled();
	});

	it.each([
		['text/plain', 'command', 415],
		['application/json', '{', 400],
	] as const)(
		'rejects invalid %s command bodies',
		async (contentType, body, status) => {
			const f = await fixture();
			const response = await fetch(`${f.url}/commands`, {
				method: 'POST',
				headers: { 'Content-Type': contentType },
				body,
			});
			expect(response.status).toBe(status);
			expect(await response.json()).toMatchObject({
				error: { code: 'invalid-command' },
			});
			expect(f.store.submit).not.toHaveBeenCalled();
		}
	);

	it.each<HuntCommand>([
		{
			type: 'add',
			nodes: [{ id: nodeId, type: 'round', name: 'Root', url: '' }],
		},
		{ type: 'move', nodeId },
		{
			type: 'update-configuration',
			configuration: {
				loggingChannelIds: {
					puzzleAdd: snowflake('add'),
					puzzleSolve: snowflake('solve'),
					puzzleStatusUpdate: snowflake('status'),
				},
			},
		},
	])(
		'forwards the neutral $type command to the authoritative store',
		async (command) => {
			const f = await fixture();
			const request = {
				commandId: '00000000-0000-4000-8000-000000000002',
				command,
			};
			const response = await fetch(`${f.url}/commands?since=0`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(request),
			});
			expect(response.status).toBe(200);
			expect(f.store.submit).toHaveBeenCalledExactlyOnceWith(
				{ huntId, guildId: 'guild' },
				request
			);
			expect(await response.json()).toEqual({
				receipt: { commandId: request.commandId, committedRevision: 1 },
				replayed: false,
				update: { type: 'snapshot', snapshot },
			});
		}
	);

	it.each([
		{ command: { type: 'move', nodeId, parentId: null } },
		{
			command: {
				type: 'add',
				nodes: [
					{
						id: nodeId,
						type: 'round',
						name: 'Root',
						url: '',
						parentId: null,
					},
				],
			},
		},
		{
			command: {
				type: 'update-configuration',
				configuration: { guildId: 'other' },
			},
		},
		{
			command: {
				type: 'set-property',
				nodeId,
				property: 'discord',
				value: null,
			},
		},
		{ command: { type: 'complete-work', durableTaskId: nodeId } },
		{
			durableTaskId: nodeId,
			command: {
				type: 'set-property',
				nodeId,
				property: 'sheetId',
				value: 'sheet',
			},
		},
	])(
		'rejects legacy roots, invalid configuration, and worker writes before submission (%#)',
		async (request) => {
			const f = await fixture();
			const response = await fetch(`${f.url}/commands?since=0`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					commandId: '00000000-0000-4000-8000-000000000002',
					...request,
				}),
			});
			expect(response.status).toBe(400);
			expect(await response.json()).toMatchObject({
				error: { code: 'invalid-command' },
			});
			expect(f.store.submit).not.toHaveBeenCalled();
			expect(f.store.readUpdates).not.toHaveBeenCalled();
		}
	);

	it('never reports a post-commit state read failure as a definitive command rejection', async () => {
		const f = await fixture();
		f.store.readUpdates.mockRejectedValueOnce(
			new HuntCommandError('not-found', 'Read failed after commit.')
		);
		const response = await fetch(`${f.url}/commands?since=0`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				commandId: '00000000-0000-4000-8000-000000000002',
				command: { type: 'add', nodes: [] },
			}),
		});
		expect(f.store.submit).toHaveBeenCalledOnce();
		expect(response.status).toBe(500);
		expect(await response.json()).toMatchObject({
			error: { code: 'internal-error' },
		});
		expect(f.onError).toHaveBeenCalledWith(
			expect.objectContaining({ cause: expect.any(HuntCommandError) })
		);
	});

	it('closes a backed-up transport instead of retaining an unbounded hint queue', async () => {
		const f = await fixture();
		const response = await fetch(`${f.url}/changes`, {
			signal: f.controller.signal,
		});
		for (
			let revision = 2;
			revision <= 10000 && f.listeners.size > 0;
			revision++
		) {
			for (const listener of f.listeners) listener.revision(revision);
		}
		expect(f.listeners.size).toBe(0);
		expect(await response.text()).toContain('event: revision');
	});

	it('registers before reading baseline and coalesces hints received during that read', async () => {
		const f = await fixture();
		f.store.readRevision.mockImplementationOnce(async () => {
			expect(f.listeners.size).toBe(1);
			for (const listener of f.listeners) {
				listener.revision(2);
				listener.revision(4);
			}
			return 1;
		});
		const response = await fetch(`${f.url}/changes`, {
			headers: { Authorization: 'Bearer test' },
			signal: f.controller.signal,
		});
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain(
			'text/event-stream'
		);
		expect(response.headers.get('cache-control')).toBe(
			'no-store, no-transform'
		);
		const reader = response.body!.getReader();
		const first = new TextDecoder().decode((await reader.read()).value);
		expect(first).toBe(
			`event: revision\ndata: ${JSON.stringify({
				huntId,
				revision: 4,
			})}\n\n`
		);
		for (const listener of f.listeners) listener.revision(5);
		expect(new TextDecoder().decode((await reader.read()).value)).toContain(
			'"revision":5'
		);
		f.disconnect();
		expect((await reader.read()).done).toBe(true);
		expect(f.listeners.size).toBe(0);
		expect(f.authorize).toHaveBeenCalledWith('Bearer test', 'guild');
	});

	it('returns JSON 503 before headers if the listener is unavailable', async () => {
		const f = await fixture();
		vi.mocked(f.changes.subscribe).mockImplementationOnce(() => {
			throw new HuntChangesUnavailableError();
		});
		const response = await fetch(`${f.url}/changes`);
		expect(response.status).toBe(503);
		expect(response.headers.get('retry-after')).toBe('30');
		expect(response.headers.get('content-type')).toContain(
			'application/json'
		);
		expect(f.store.readRevision).not.toHaveBeenCalled();
	});

	it('returns 503 if listening is lost during baseline and does not leak subscriptions on 404', async () => {
		const f = await fixture();
		f.store.readRevision.mockImplementationOnce(async () => {
			f.disconnect();
			return 1;
		});
		const response = await fetch(`${f.url}/changes`);
		expect(response.status).toBe(503);
		expect(response.headers.get('retry-after')).toBe('30');
		f.store.readRevision.mockRejectedValueOnce(
			new HuntCommandError('not-found', 'Missing.')
		);
		expect((await fetch(`${f.url}/changes`)).status).toBe(404);
		expect(f.listeners.size).toBe(0);
	});

	it('authorizes scope and origin before subscribing and releases aborted streams', async () => {
		const f = await fixture();
		f.authorize.mockRejectedValueOnce(
			new HuntCommandError('forbidden', 'Membership.')
		);
		expect((await fetch(`${f.url}/changes`)).status).toBe(403);
		expect(
			(
				await fetch(`${f.url}/changes`, {
					headers: { Origin: 'https://denied.test' },
				})
			).status
		).toBe(403);
		expect(f.changes.subscribe).not.toHaveBeenCalled();
		await fetch(`${f.url}/changes`, { signal: f.controller.signal });
		f.controller.abort();
		await vi.waitFor(() => expect(f.listeners.size).toBe(0));
	});

	it('passes read cursors separately from command intent and rejects invalid cursors before submitting', async () => {
		const f = await fixture();
		expect((await fetch(`${f.url}?since=0`)).status).toBe(200);
		expect(f.store.readUpdates).toHaveBeenCalledWith(
			{ huntId, guildId: 'guild' },
			0
		);
		const request = {
			commandId: '00000000-0000-4000-8000-000000000002',
			command: { type: 'add', nodes: [] },
		};
		expect(
			(
				await fetch(`${f.url}/commands?since=0`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(request),
				})
			).status
		).toBe(200);
		expect(f.store.submit).toHaveBeenCalledWith(
			{ huntId, guildId: 'guild' },
			request
		);
		expect(
			(
				await fetch(`${f.url}/commands?since=-1`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(request),
				})
			).status
		).toBe(400);
		expect(f.store.submit).toHaveBeenCalledOnce();
	});
});

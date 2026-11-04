import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HuntCommandError } from '@belle-puzzles/puzzlehunt-model/document';
import type { HuntSnapshot } from '@belle-puzzles/puzzlehunt-model/document';
import { createPuzzlehuntApp } from '../app.js';
import { HuntChangesUnavailableError } from '../changes.js';
import type { HuntChangeFeed } from '../changes.js';

const huntId = '00000000-0000-4000-8000-000000000001';
const snapshot: HuntSnapshot = {
	huntId,
	guildId: 'guild',
	schemaVersion: 1,
	revision: 1,
	name: 'Hunt',
	configuration: {},
	document: { nodes: {} },
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

async function fixture() {
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
		submitUpdates: vi.fn(async (_scope, request, _since) => ({
			update: { type: 'snapshot' as const, snapshot },
			receipt: { commandId: request.commandId, committedRevision: 1 },
			replayed: false,
		})),
	};
	const authorize = vi.fn(
		async (_authorization: string | undefined, _guild: string) => {}
	);
	const onError = vi.fn();
	const server = createServer(
		createPuzzlehuntApp({
			store,
			changes,
			authorize,
			onError,
			allowedOrigins: ['https://allowed.test'],
		})
	);
	servers.push(server);
	await new Promise<void>((resolve) =>
		server.listen(0, '127.0.0.1', resolve)
	);
	const address = server.address();
	if (!address || typeof address === 'string')
		throw new Error('Expected local port.');
	const url = `http://127.0.0.1:${address.port}/guilds/guild/hunts/${huntId}`;
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
		expect((await fetch(`${f.url}/changes`)).status).toBe(503);
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
		expect(f.store.submitUpdates).toHaveBeenCalledWith(
			{ huntId, guildId: 'guild' },
			request,
			0
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
		expect(f.store.submitUpdates).toHaveBeenCalledOnce();
	});
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyHuntCommand, snowflake } from '../../document.js';
import type { HuntDocumentClient, HuntSnapshot } from '../../document.js';
import { HttpHuntDocumentClient } from '../../http/client.js';
import {
	readHuntRevisionStream,
	watchHuntChanges,
	watchPuzzlehuntModel,
} from '../../http/changes.js';
import type { HuntChangeWatchOptions } from '../../http/changes.js';
import { HuntProtocolError } from '../../http/protocol.js';
import { PuzzlehuntModel } from '../../model/puzzlehunt.js';

const scope = {
	huntId: '00000000-0000-4000-8000-000000000001',
	guildId: snowflake('guild'),
};
const base: HuntSnapshot = {
	...scope,
	schemaVersion: 1,
	revision: 0,
	document: { name: 'Hunt', configuration: {}, nodes: {} },
};
const encoder = new TextEncoder();
const event = (revision: number) =>
	`event: revision\ndata: ${JSON.stringify({
		huntId: scope.huntId,
		revision,
	})}\n\n`;
function body(...chunks: Uint8Array[]) {
	return new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(chunk);
			controller.close();
		},
	});
}
function live() {
	let controller!: ReadableStreamDefaultController<Uint8Array>;
	const stream = new ReadableStream<Uint8Array>({
		start(value) {
			controller = value;
		},
	});
	return {
		controller,
		response: new Response(stream, {
			headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
		}),
	};
}
async function collect(stream: ReadableStream<Uint8Array>) {
	const revisions: number[] = [];
	for await (const revision of readHuntRevisionStream(
		stream,
		scope.huntId,
		new AbortController().signal,
		() => {}
	))
		revisions.push(revision);
	return revisions;
}
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('Hunt SSE client', () => {
	it('frames arbitrary byte chunks, CRLF, multiline data, UTF-8 comments and unknown events', async () => {
		const text = encoder.encode(
			`: caf\u00e9\r\n\r\nevent: unknown\rdata: ignored\r\revent: revision\r\ndata: {"huntId":"${
				scope.huntId
			}",\r\ndata: "revision":2}\r\n\r\n${event(4)}`
		);
		expect(
			await collect(
				body(...Array.from(text, (byte) => Uint8Array.of(byte)))
			)
		).toEqual([2, 4]);
	});

	it.each([
		'event: revision\ndata: not-json\n\n',
		`event: revision\ndata: {"huntId":"${scope.huntId}","revision":-1}\n\n`,
		'event: revision\ndata: {"huntId":"00000000-0000-4000-8000-000000000002","revision":1}\n\n',
		`data: ${'x'.repeat(65537)}\n\n`,
	])('rejects invalid known events and oversized frames %#', async (text) => {
		await expect(
			collect(body(encoder.encode(text)))
		).rejects.toBeInstanceOf(HuntProtocolError);
	});

	it('ignores an incomplete event on EOF', async () => {
		expect(
			await collect(body(encoder.encode(event(1).slice(0, -1))))
		).toEqual([]);
	});

	it('uses fresh authorization on reconnect and never applies the REST lifetime timeout', async () => {
		vi.useFakeTimers();
		vi.spyOn(Math, 'random').mockReturnValue(0.5);
		const first = live();
		const second = live();
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockResolvedValueOnce(first.response)
			.mockResolvedValueOnce(second.response);
		const token = vi.fn(() => 'first');
		const client = new HttpHuntDocumentClient({
			baseUrl: 'https://api.example.test',
			getToken: token,
			fetch,
			timeoutMs: 5,
		});
		const onRevision = vi.fn();
		const onError = vi.fn();
		const subscription = client.watch(scope, { onRevision, onError });
		await vi.advanceTimersByTimeAsync(0);
		first.controller.enqueue(encoder.encode(event(1)));
		await vi.advanceTimersByTimeAsync(40000);
		expect(onRevision).toHaveBeenCalledWith(1);
		expect(fetch).toHaveBeenCalledOnce();
		token.mockReturnValue('second');
		first.controller.close();
		await vi.advanceTimersByTimeAsync(1000);
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(fetch.mock.calls[1][1]?.headers).toMatchObject({
			Authorization: 'Bearer second',
			Accept: 'text/event-stream',
		});
		expect(fetch.mock.calls[1][1]?.headers).not.toHaveProperty(
			'Last-Event-ID'
		);
		subscription.close();
		await subscription.done;
		expect(onError).not.toHaveBeenCalled();
	});

	it('pauses at 401 and resumes explicitly with renewed credentials', async () => {
		vi.useFakeTimers();
		const stream = live();
		const request = vi
			.fn(async () => new Response(null, { status: 401 }))
			.mockResolvedValueOnce(new Response(null, { status: 401 }))
			.mockResolvedValueOnce(stream.response);
		const onError = vi.fn();
		const subscription = watchHuntChanges(scope, request, {
			onRevision: vi.fn(),
			onError,
		});
		await vi.advanceTimersByTimeAsync(120000);
		expect(request).toHaveBeenCalledOnce();
		expect(onError).toHaveBeenCalledWith(
			expect.objectContaining({ status: 401 })
		);
		subscription.reconnect();
		await vi.advanceTimersByTimeAsync(0);
		expect(request).toHaveBeenCalledTimes(2);
		subscription.close();
		await subscription.done;
	});

	it('honors Retry-After rather than retrying a throttled stream too early', async () => {
		vi.useFakeTimers();
		const request = vi
			.fn(async () => live().response)
			.mockResolvedValueOnce(
				new Response(null, {
					status: 429,
					headers: { 'Retry-After': '10' },
				})
			);
		const subscription = watchHuntChanges(scope, request, {
			onRevision: vi.fn(),
			onError: vi.fn(),
		});
		await vi.advanceTimersByTimeAsync(9999);
		expect(request).toHaveBeenCalledOnce();
		await vi.advanceTimersByTimeAsync(1);
		expect(request).toHaveBeenCalledTimes(2);
		subscription.close();
		await subscription.done;
	});

	it('can close while an asynchronous credential provider has not resolved', async () => {
		const client = new HttpHuntDocumentClient({
			baseUrl: 'https://api.example.test',
			getToken: () => new Promise<string>(() => {}),
			fetch: vi.fn(),
		});
		const subscription = client.watch(scope, {
			onRevision: vi.fn(),
			onError: vi.fn(),
		});
		subscription.close();
		await subscription.done;
	});

	it.each([403, 404, 400])(
		'stops on a terminal HTTP %s without retrying',
		async (status) => {
			const request = vi.fn(async () => new Response(null, { status }));
			const onError = vi.fn();
			await watchHuntChanges(scope, request, {
				onRevision: vi.fn(),
				onError,
			}).done;
			expect(request).toHaveBeenCalledOnce();
			expect(onError).toHaveBeenCalledOnce();
		}
	);

	it('stops automatic reconnection for bad known payloads', async () => {
		const request = vi.fn(
			async () =>
				new Response('event: revision\ndata: {}\n\n', {
					headers: { 'Content-Type': 'text/event-stream' },
				})
		);
		const onError = vi.fn();
		await watchHuntChanges(scope, request, { onRevision: vi.fn(), onError })
			.done;
		expect(onError).toHaveBeenCalledWith(expect.any(HuntProtocolError));
		expect(request).toHaveBeenCalledOnce();
	});

	it('reports a watchdog timeout and reconnects with backoff', async () => {
		vi.useFakeTimers();
		vi.spyOn(Math, 'random').mockReturnValue(0.5);
		const request = vi.fn(async () => live().response);
		const onError = vi.fn();
		const subscription = watchHuntChanges(scope, request, {
			onRevision: vi.fn(),
			onError,
		});
		await vi.advanceTimersByTimeAsync(46000);
		expect(onError).toHaveBeenCalledWith(
			expect.objectContaining({
				message: 'Puzzlehunt change stream timed out.',
			})
		);
		expect(request).toHaveBeenCalledTimes(2);
		subscription.close();
		await subscription.done;
	});

	it('keeps notification bursts behind an uncertain write without automatically retrying it', async () => {
		let snapshot = base;
		const client: HuntDocumentClient = {
			read: vi.fn(async () => snapshot),
			submit: vi.fn(async (_scope, request) => {
				snapshot = {
					...snapshot,
					revision: 100,
					document: applyHuntCommand(
						snapshot.document,
						request.command,
						1
					).document,
				};
				return {
					snapshot,
					receipt: {
						commandId: request.commandId,
						committedRevision: 100,
					},
					replayed: true,
				};
			}),
		};
		vi.mocked(client.submit).mockRejectedValueOnce(
			new Error('Uncertain write.')
		);
		const model = new PuzzlehuntModel(client, base);
		let callbacks!: HuntChangeWatchOptions;
		let finish!: () => void;
		const done = new Promise<void>((resolve) => {
			finish = resolve;
		});
		const source = {
			watch: (_scope: unknown, options: HuntChangeWatchOptions) => {
				callbacks = options;
				return { done, close: finish, reconnect: vi.fn() };
			},
		};
		const subscription = watchPuzzlehuntModel(source, model, {
			onError: vi.fn(),
		});
		model.addRound('Pending', '');
		await expect(model.flush()).rejects.toThrow('Uncertain write.');
		for (let revision = 1; revision <= 100; revision++)
			callbacks.onRevision(revision);
		expect(client.read).not.toHaveBeenCalled();
		expect(client.submit).toHaveBeenCalledOnce();
		await model.retryPending();
		expect(client.submit).toHaveBeenCalledTimes(2);
		expect(client.read).not.toHaveBeenCalled();
		subscription.close();
		await subscription.done;
	});
});

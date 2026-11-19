import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Client } from 'discord.js';
import { HttpHuntDocumentClient } from '@belle-puzzles/puzzlehunt-model/http';
import { createClient } from '../client.js';
import { MockDiscord } from './mockDiscord.js';
import type { LocalPostgresBackend } from '../local-postgres.js';

afterEach(() => vi.restoreAllMocks());

function fixture(local = true) {
	const discord = new MockDiscord();
	const order: string[] = [];
	const worker = {
		start: vi.fn(async () => {
			order.push('start');
		}),
		reconcile: vi.fn(async () => {}),
		stop: vi.fn(async () => {
			order.push('stop');
		}),
	};
	const backend: LocalPostgresBackend = {
		guildIds: [discord.getGuild().id],
		documents: new HttpHuntDocumentClient({
			baseUrl: 'http://127.0.0.1:3001',
			getToken: () => 'unused',
		}),
		worker,
		close: vi.fn(async () => {
			order.push('pool');
		}),
	};
	const provider = {
		getPuzzlehunt: vi.fn(),
		close: vi.fn(async () => {
			order.push('provider');
		}),
	};
	const onError = vi.fn(async () => {});
	const client = createClient({
		token: 'mock',
		baseClient: discord.getClient(),
		puzzlehuntProvider: provider,
		localPostgres: local ? backend : undefined,
		allowList: local ? [...backend.guildIds] : undefined,
		onError,
	});
	return { client, backend, worker, provider, onError, order };
}

describe('Bot backend lifecycle', () => {
	it('keeps Fluid defaults and never starts a PostgreSQL worker without opt-in', async () => {
		const { client, worker, backend } = fixture(false);
		expect(client.rest.options.retries).not.toBe(0);
		client.emit('clientReady', client as Client<true>);
		await client.ensurePendingWorkProcessed();
		await client.shutdown();
		expect(worker.start).not.toHaveBeenCalled();
		expect(worker.stop).not.toHaveBeenCalled();
		expect(backend.close).not.toHaveBeenCalled();
	});

	it('starts only on ready, once, and stops admission while settling work before the pool closes', async () => {
		const { client, worker, order } = fixture();
		expect(worker.start).not.toHaveBeenCalled();
		client.emit('clientReady', client as Client<true>);
		client.emit('clientReady', client as Client<true>);
		await client.ensurePendingWorkProcessed();
		let finish: () => void;
		client.pushAsyncWork(
			'command',
			new Promise<void>((resolve) => {
				finish = resolve;
			})
		);
		const stopped = client.shutdown();
		const command = vi.spyOn(client.commands.get('create'), 'execute');
		client.emit(
			'interactionCreate',
			new MockDiscord().createCommandInteraction({
				name: 'create',
				options: [],
			})
		);
		expect(command).not.toHaveBeenCalled();
		expect(worker.stop).not.toHaveBeenCalled();
		finish();
		await stopped;
		await client.shutdown();
		expect(order).toEqual(['start', 'stop', 'provider', 'pool']);
		expect(worker.start).toHaveBeenCalledOnce();
	});

	it('awaits worker release and still closes other resources after a settlement failure', async () => {
		const { client, worker, provider, backend, order } = fixture();
		await client.ensurePendingWorkProcessed();
		let finish: () => void;
		worker.stop.mockImplementationOnce(async () => {
			await new Promise<void>((resolve) => {
				finish = resolve;
			});
			order.push('stop');
		});
		provider.close.mockRejectedValueOnce(
			new Error('Uncertain retained command ID')
		);
		const stopped = client.shutdown();
		await vi.waitFor(() => expect(worker.stop).toHaveBeenCalledOnce());
		expect(backend.close).not.toHaveBeenCalled();
		finish();
		await expect(stopped).rejects.toThrow(
			'Bot shutdown could not settle all work'
		);
		expect(backend.close).toHaveBeenCalledOnce();
		expect(order).toEqual(['stop', 'pool']);
	});

	it('does not start if readiness arrives after shutdown', async () => {
		const { client, worker } = fixture();
		await client.shutdown();
		client.emit('clientReady', client as Client<true>);
		expect(worker.start).not.toHaveBeenCalled();
	});

	it('settles asynchronous error replies without busy-looping on a rejected work promise', async () => {
		const { client, onError } = fixture();
		await client.ensurePendingWorkProcessed();
		onError.mockImplementationOnce(async () => {
			await new Promise((resolve) => setTimeout(resolve, 10));
		});
		client.pushAsyncWork(
			'command',
			Promise.reject(new Error('Failed command'))
		);
		await expect(client.ensurePendingWorkProcessed()).rejects.toThrow(
			'Bot work failed.'
		);
		expect(onError).toHaveBeenCalledOnce();
		await client.shutdown();
	});

	it.each(['missing allow list', 'unlisted guild', 'blocked guild'])(
		'rejects unauthorized local guilds at runtime: %s',
		(reason) => {
			const discord = new MockDiscord();
			const backend: LocalPostgresBackend = {
				guildIds: [discord.getGuild().id],
				documents: new HttpHuntDocumentClient({
					baseUrl: 'http://127.0.0.1:3001',
					getToken: () => 'unused',
				}),
				worker: {
					start: async () => {},
					stop: async () => {},
					reconcile: async () => {},
				},
				close: async () => {},
			};
			expect(() =>
				createClient({
					token: 'mock',
					baseClient: discord.getClient(),
					puzzlehuntProvider: { getPuzzlehunt: vi.fn() },
					localPostgres: backend,
					allowList:
						reason === 'missing allow list'
							? undefined
							: reason === 'unlisted guild'
							? ['other-guild']
							: [...backend.guildIds],
					blockList:
						reason === 'blocked guild'
							? [...backend.guildIds]
							: undefined,
				})
			).toThrow('explicit guild authorization');
		}
	);
});

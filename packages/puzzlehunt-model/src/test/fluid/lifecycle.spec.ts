import { EagerCheckout, SharedTree } from '@fluid-experimental/tree';
import { AzureClient } from '@fluidframework/azure-client';
import { FluidContainer } from '@fluidframework/fluid-static';
import { InsecureTokenProvider } from '@fluidframework/test-client-utils';
import { afterEach, describe, expect, inject, it, vi } from 'vitest';
import {
	createNewPuzzlehunt,
	loadExistingPuzzlehunt,
} from '../../fluid/index.js';
import type { IPuzzlehuntSession } from '../../model/types.js';
import { Puzzlehunt } from '../../puzzlehunt.js';
import { TestLogger } from '../utils.js';

describe('Fluid session lifecycle', () => {
	const sessions: IPuzzlehuntSession[] = [];

	function client() {
		const user = {
			id: crypto.randomUUID(),
			name: 'Lifecycle test',
		};
		return new AzureClient({
			connection: {
				type: 'local',
				tokenProvider: new InsecureTokenProvider('', user),
				endpoint: inject('fluidEndpoint'),
			},
			logger: new TestLogger(),
		});
	}

	async function create() {
		const azure = client();
		const createContainer = vi.spyOn(azure, 'createContainer');
		const session = await createNewPuzzlehunt(azure, 'lifecycle-guild');
		sessions.push(session);
		await session.puzzlehunt.flush();
		const { container } = await createContainer.mock.results[0].value;
		if (!(container instanceof FluidContainer)) {
			throw new Error('Expected the Azure client Fluid container.');
		}
		return { session, container };
	}

	afterEach(async () => {
		vi.restoreAllMocks();
		for (const session of sessions.splice(0)) {
			if (session.state.status === 'open') {
				await session.close();
			}
		}
	});

	it.each(['created', 'loaded'] as const)(
		'saves a %s hunt before closing, and permits loading its edits afterward',
		async (kind) => {
			const initial = await create();
			const session =
				kind === 'created'
					? initial.session
					: await loadExistingPuzzlehunt(
							client(),
							initial.session.id
					  );
			if (kind === 'loaded') {
				sessions.push(session);
			}
			const states: string[] = [];
			session.subscribeLifecycle((state) => states.push(state.status));
			session.puzzlehunt.addRound('Saved before close', '');
			const closing = session.close();
			expect(session.state.status).toBe('closing');
			expect(session.close()).toBe(closing);
			expect(() => session.puzzlehunt.addRound('Too late', '')).toThrow(
				/closing or closed/
			);
			await closing;
			expect(states).toEqual(['closing', 'closed']);
			await session.close();
			await expect(session.puzzlehunt.flush()).rejects.toThrow(/closed/);
			await expect(session.puzzlehunt.refresh()).rejects.toThrow(
				/closed/
			);

			const reloaded = await loadExistingPuzzlehunt(client(), session.id);
			sessions.push(reloaded);
			expect(
				reloaded.puzzlehunt.rounds.map((round) => round.name)
			).toEqual(['Saved before close']);
		}
	);

	it('waits for all changes, not merely a saved event, and cleans subscriptions', async () => {
		const { session, container } = await create();
		const subscribeChanges = Puzzlehunt.prototype.subscribeChanges;
		const cleanups: (() => void)[] = [];
		vi.spyOn(Puzzlehunt.prototype, 'subscribeChanges').mockImplementation(
			function (this: Puzzlehunt, listener) {
				const cleanup = vi.fn<() => void>(
					subscribeChanges.call(this, listener)
				);
				cleanups.push(cleanup);
				return cleanup;
			}
		);
		const savedCount = container.listenerCount('saved');
		const dirtyCount = container.listenerCount('dirty');
		const ui = vi.fn();
		const changes = vi.fn();
		const lifecycle = vi.fn();
		const removed = vi.fn();
		const unsubscribeUi = session.puzzlehunt.subscribe(ui);
		const unsubscribeChanges = session.puzzlehunt.subscribeChanges(changes);
		const unsubscribeLifecycle = session.subscribeLifecycle(lifecycle);
		session.subscribeLifecycle(removed)();
		const dirty = vi
			.spyOn(container, 'isDirty', 'get')
			.mockReturnValue(true);
		const flushed = vi.fn();
		const flushing = session.puzzlehunt.flush().then(flushed);
		const closing = session.close();
		await Promise.resolve();
		container.emit('saved');
		await Promise.resolve();
		expect(flushed).not.toHaveBeenCalled();
		expect(container.disposed).toBe(false);
		dirty.mockReturnValue(false);
		container.emit('saved');
		await Promise.all([flushing, closing]);
		expect(flushed).toHaveBeenCalledOnce();
		expect(container.disposed).toBe(true);
		expect(ui).toHaveBeenCalled();
		expect(changes).not.toHaveBeenCalled();
		expect(lifecycle.mock.calls.map(([state]) => state.status)).toEqual([
			'closing',
			'closed',
		]);
		expect(removed).not.toHaveBeenCalled();
		expect(container.listenerCount('saved')).toBeLessThan(savedCount);
		expect(container.listenerCount('dirty')).toBe(dirtyCount);
		expect(cleanups).toHaveLength(2);
		for (const cleanup of cleanups) {
			expect(cleanup).toHaveBeenCalledOnce();
		}
		unsubscribeUi();
		unsubscribeChanges();
		unsubscribeLifecycle();
		const uiCalls = ui.mock.calls.length;
		container.emit('dirty');
		container.emit('saved');
		expect(ui).toHaveBeenCalledTimes(uiCalls);
		const late = vi.fn();
		session.subscribeLifecycle(late)();
		expect(late).toHaveBeenCalledExactlyOnceWith({ status: 'closed' });
	});

	it('does not notify unsubscribed model listeners', async () => {
		const { session, container } = await create();
		const ui = vi.fn();
		const changes = vi.fn();
		session.puzzlehunt.subscribe(ui)();
		session.puzzlehunt.subscribeChanges(changes)();
		session.puzzlehunt.addRound('Unobserved', '');
		container.emit('dirty');
		await session.close();
		expect(ui).not.toHaveBeenCalled();
		expect(changes).not.toHaveBeenCalled();
	});

	it.each([
		'disposal',
		'container error',
		'tree error',
		'checkout error',
	] as const)(
		'rejects in-flight flushes and close on %s and notifies once',
		async (failure) => {
			const errorSubscriptions = vi.spyOn(
				Puzzlehunt.prototype,
				'subscribeErrors'
			);
			const { session, container } = await create();
			const dirty = vi
				.spyOn(container, 'isDirty', 'get')
				.mockReturnValue(true);
			const lifecycle = vi.fn();
			session.subscribeLifecycle(lifecycle);
			const first = session.puzzlehunt.flush();
			const second = session.puzzlehunt.flush();
			const closing = session.close();
			const error = new Error(`Test ${failure}`);
			const expected =
				failure === 'disposal' ? /before acknowledgement/ : error;
			const rejected = [
				expect(first).rejects.toThrow(expected),
				expect(second).rejects.toThrow(expected),
				expect(closing).rejects.toThrow(expected),
			];
			if (failure === 'disposal') {
				container.dispose();
			} else if (failure === 'container error') {
				container.emit('disposed', error);
			} else if (failure === 'tree error') {
				const tree = container.initialObjects.hunt;
				if (!(tree instanceof SharedTree)) {
					throw new Error('Expected SharedTree.');
				}
				tree.emit('error', error);
			} else {
				const hunt = errorSubscriptions.mock.contexts[0];
				if (!(hunt instanceof Puzzlehunt)) {
					throw new Error('Expected the native puzzlehunt.');
				}
				const checkout = Reflect.get(hunt, 'checkout');
				if (!(checkout instanceof EagerCheckout)) {
					throw new Error('Expected the native checkout.');
				}
				checkout.emit('error', error);
			}
			await Promise.all(rejected);
			expect(session.state.status).toBe('failed');
			expect(container.disposed).toBe(true);
			expect(session.close()).toBe(closing);
			await expect(session.close()).rejects.toThrow(expected);
			await expect(session.puzzlehunt.flush()).rejects.toThrow(expected);
			await expect(session.puzzlehunt.refresh()).rejects.toThrow(
				expected
			);
			expect(() => session.puzzlehunt.addRound('Too late', '')).toThrow(
				expected
			);
			expect(lifecycle.mock.calls.map(([state]) => state.status)).toEqual(
				['closing', 'failed']
			);
			dirty.mockReturnValue(false);
			const late = vi.fn();
			session.subscribeLifecycle(late)();
			expect(late).toHaveBeenCalledExactlyOnceWith(session.state);
			container.emit('disposed');
			expect(lifecycle).toHaveBeenCalledTimes(2);
		}
	);

	it('treats a clean external close as closed and close remains safe', async () => {
		const { session, container } = await create();
		const lifecycle = vi.fn();
		session.subscribeLifecycle(lifecycle);
		container.dispose();
		expect(session.state).toEqual({ status: 'closed' });
		await session.close();
		await session.close();
		expect(lifecycle).toHaveBeenCalledExactlyOnceWith({ status: 'closed' });
	});

	it('reports a background error without starting an unobserved close promise', async () => {
		const { session, container } = await create();
		const lifecycle = vi.fn();
		const ui = vi.fn();
		session.subscribeLifecycle(lifecycle);
		session.puzzlehunt.subscribe(ui);
		const tree = container.initialObjects.hunt;
		if (!(tree instanceof SharedTree)) {
			throw new Error('Expected SharedTree.');
		}
		const error = new Error('Background tree failure');
		tree.emit('error', error);
		await Promise.resolve();
		expect(session.state).toEqual({ status: 'failed', error });
		expect(container.disposed).toBe(true);
		expect(lifecycle).toHaveBeenCalledExactlyOnceWith(session.state);
		expect(ui).toHaveBeenCalledOnce();
		await expect(session.close()).rejects.toBe(error);
	});

	it.each(['initialization', 'attachment'] as const)(
		'releases the container if %s fails',
		async (stage) => {
			const azure = client();
			const originalCreate = azure.createContainer.bind(azure);
			const createContainer = vi.spyOn(azure, 'createContainer');
			const error = new Error(`${stage} failed`);
			if (stage === 'initialization') {
				vi.spyOn(
					Puzzlehunt.prototype,
					'setGuildId'
				).mockImplementationOnce(() => {
					throw error;
				});
			} else {
				createContainer.mockImplementationOnce(async (schema) => {
					const result = await originalCreate(schema);
					vi.spyOn(result.container, 'attach').mockRejectedValueOnce(
						error
					);
					return result;
				});
			}
			await expect(createNewPuzzlehunt(azure, 'guild')).rejects.toBe(
				error
			);
			const { container } = await createContainer.mock.results[0].value;
			expect(container.disposed).toBe(true);
		}
	);
});

import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	HuntChangesUnavailableError,
	PostgresHuntChangeFeed,
} from '../changes.js';

class Connection extends EventEmitter {
	connect = vi.fn(async () => {});
	query = vi.fn(async (_text: string) => {});
	end = vi.fn(async () => {});
}
const huntId = '00000000-0000-4000-8000-000000000001';
const feeds: PostgresHuntChangeFeed[] = [];
afterEach(async () => {
	for (const feed of feeds.splice(0)) await feed.close();
	vi.useRealTimers();
});

describe('Dedicated PostgreSQL LISTEN lifecycle', () => {
	it('registers only after LISTEN commits, multiplexes hunts, and releases subscriptions', async () => {
		const connection = new Connection();
		const feed = new PostgresHuntChangeFeed(() => connection, vi.fn());
		feeds.push(feed);
		expect(() => feed.subscribe(huntId, vi.fn(), vi.fn())).toThrow(
			HuntChangesUnavailableError
		);
		feed.start();
		await vi.waitFor(() =>
			expect(connection.query).toHaveBeenCalledWith('LISTEN hunt_changed')
		);
		const revision = vi.fn();
		const other = vi.fn();
		const unsubscribe = feed.subscribe(huntId, revision, vi.fn());
		feed.subscribe('other', other, vi.fn());
		connection.emit('notification', {
			channel: 'hunt_changed',
			payload: JSON.stringify({ huntId, revision: 4 }),
		});
		expect(revision).toHaveBeenCalledWith(4);
		expect(other).not.toHaveBeenCalled();
		unsubscribe();
		connection.emit('notification', {
			channel: 'hunt_changed',
			payload: JSON.stringify({ huntId, revision: 5 }),
		});
		expect(revision).toHaveBeenCalledOnce();
		expect(connection.connect).toHaveBeenCalledOnce();
	});

	it('closes subscribers on connection loss and reestablishes LISTEN on a fresh connection', async () => {
		vi.useFakeTimers();
		const first = new Connection();
		const second = new Connection();
		const factory = vi.fn(() => second).mockReturnValueOnce(first);
		const onError = vi.fn();
		const feed = new PostgresHuntChangeFeed(factory, onError);
		feeds.push(feed);
		feed.start();
		await vi.advanceTimersByTimeAsync(0);
		const disconnected = vi.fn();
		feed.subscribe(huntId, vi.fn(), disconnected);
		first.emit('error', new Error('Connection lost.'));
		expect(disconnected).toHaveBeenCalledOnce();
		expect(() => feed.subscribe(huntId, vi.fn(), vi.fn())).toThrow(
			HuntChangesUnavailableError
		);
		await vi.advanceTimersByTimeAsync(1000);
		expect(second.query).toHaveBeenCalledWith('LISTEN hunt_changed');
		expect(() => feed.subscribe(huntId, vi.fn(), vi.fn())).not.toThrow();
		first.emit('end');
		expect(onError).toHaveBeenCalledOnce();
	});

	it('reports failed LISTEN and malformed notifications rather than silently dropping them', async () => {
		vi.useFakeTimers();
		const first = new Connection();
		first.query.mockRejectedValueOnce(new Error('LISTEN failed.'));
		const second = new Connection();
		const factory = vi.fn(() => second).mockReturnValueOnce(first);
		const onError = vi.fn();
		const feed = new PostgresHuntChangeFeed(factory, onError);
		feeds.push(feed);
		feed.start();
		await vi.advanceTimersByTimeAsync(1000);
		expect(onError).toHaveBeenCalledOnce();
		const disconnected = vi.fn();
		feed.subscribe(huntId, vi.fn(), disconnected);
		second.emit('notification', { channel: 'hunt_changed', payload: '{}' });
		expect(disconnected).toHaveBeenCalledOnce();
		expect(onError).toHaveBeenCalledTimes(2);
	});
});

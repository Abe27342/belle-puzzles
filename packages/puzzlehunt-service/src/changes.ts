import { huntRevisionNotificationSchema } from '@belle-puzzles/puzzlehunt-model/http';

export class HuntChangesUnavailableError extends Error {
	constructor() {
		super('Puzzlehunt change notifications are temporarily unavailable.');
		this.name = 'HuntChangesUnavailableError';
	}
}

export interface HuntChangeFeed {
	subscribe(
		huntId: string,
		revision: (value: number) => void,
		disconnected: () => void
	): () => void;
}

export interface HuntListenerConnection {
	connect(): Promise<unknown>;
	query(text: string): Promise<unknown>;
	end(): Promise<void>;
	on(event: 'error', listener: (error: Error) => void): unknown;
	on(event: 'end', listener: () => void): unknown;
	on(
		event: 'notification',
		listener: (notification: { channel: string; payload?: string }) => void
	): unknown;
}

interface Subscriber {
	revision: (value: number) => void;
	disconnected: () => void;
}

/** One dedicated LISTEN connection per host, never a pooled transaction connection. */
export class PostgresHuntChangeFeed implements HuntChangeFeed {
	private connection: HuntListenerConnection | undefined;
	private connecting: Promise<void> | undefined;
	private ready = false;
	private stopped = false;
	private retry: ReturnType<typeof setTimeout> | undefined;
	private retryMs = 1000;
	private readonly subscribers = new Map<string, Set<Subscriber>>();

	constructor(
		private readonly createConnection: () => HuntListenerConnection,
		private readonly onError: (error: unknown) => void = console.error
	) {}

	start(): void {
		if (this.stopped) {
			throw new Error('A closed change feed cannot be restarted.');
		}
		if (!this.connection && !this.connecting && !this.retry) {
			this.connecting = this.connect().finally(() => {
				this.connecting = undefined;
			});
		}
	}

	subscribe(
		huntId: string,
		revision: (value: number) => void,
		disconnected: () => void
	): () => void {
		if (!this.ready || this.stopped) {
			throw new HuntChangesUnavailableError();
		}
		const subscriber = { revision, disconnected };
		let listeners = this.subscribers.get(huntId);
		if (!listeners) {
			listeners = new Set();
			this.subscribers.set(huntId, listeners);
		}
		listeners.add(subscriber);
		return () => {
			listeners.delete(subscriber);
			if (
				listeners.size === 0 &&
				this.subscribers.get(huntId) === listeners
			) {
				this.subscribers.delete(huntId);
			}
		};
	}

	async close(): Promise<void> {
		this.stopped = true;
		this.ready = false;
		clearTimeout(this.retry);
		this.retry = undefined;
		this.disconnectSubscribers();
		const connection = this.connection;
		this.connection = undefined;
		if (connection) {
			await connection.end();
		}
		await this.connecting;
	}

	private async connect(): Promise<void> {
		let connection: HuntListenerConnection;
		try {
			connection = this.createConnection();
		} catch (error) {
			this.onError(error);
			this.scheduleRetry();
			return;
		}
		this.connection = connection;
		connection.on('error', (error) => this.failed(connection, error));
		connection.on('end', () =>
			this.failed(
				connection,
				new Error('PostgreSQL LISTEN connection ended.')
			)
		);
		connection.on('notification', (notification) => {
			if (
				!this.ready ||
				this.connection !== connection ||
				notification.channel !== 'hunt_changed'
			) {
				return;
			}
			try {
				const hint = huntRevisionNotificationSchema.parse(
					JSON.parse(notification.payload ?? '')
				);
				for (const subscriber of this.subscribers.get(hint.huntId) ??
					[]) {
					subscriber.revision(hint.revision);
				}
			} catch (error) {
				this.failed(connection, error);
			}
		});
		try {
			await connection.connect();
			await connection.query('LISTEN hunt_changed');
			if (this.connection === connection && !this.stopped) {
				this.ready = true;
				this.retryMs = 1000;
			}
		} catch (error) {
			this.failed(connection, error);
		}
	}

	private failed(connection: HuntListenerConnection, error: unknown): void {
		if (this.connection !== connection) {
			return;
		}
		this.connection = undefined;
		this.ready = false;
		this.onError(error);
		this.disconnectSubscribers();
		void connection.end().catch(this.onError);
		this.scheduleRetry();
	}

	private scheduleRetry(): void {
		if (!this.stopped) {
			this.retry = setTimeout(() => {
				this.retry = undefined;
				this.start();
			}, this.retryMs);
			this.retry.unref();
			this.retryMs = Math.min(30000, this.retryMs * 2);
		}
	}

	private disconnectSubscribers(): void {
		const subscribers = [...this.subscribers.values()].flatMap(
			(listeners) => [...listeners]
		);
		this.subscribers.clear();
		for (const subscriber of subscribers) {
			subscriber.disconnected();
		}
	}
}

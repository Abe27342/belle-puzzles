import { Pool } from 'pg';
import type { Guild } from 'discord.js';
import { HttpHuntDocumentClient } from '@belle-puzzles/puzzlehunt-model/http';
import type { HuntScope } from '@belle-puzzles/puzzlehunt-model/document';
import {
	PostgresPuzzlehuntStore,
	PostgresHuntIntegrationStore,
} from '@belle-puzzles/puzzlehunt-model/postgres';
import type { LocalPostgresConfiguration } from './local-postgres-config.js';
import { readLocalServiceToken } from './local-postgres-config.js';
import { createDurableIntegrationWorker } from './sync/durableWorker.js';
import type { DurableIntegrationWorker } from './sync/durableWorker.js';

/**
 * Server-only HTTP document access and trusted durable-worker ownership.
 *
 * @remarks
 * Construct only after explicit local opt-in validation; `DATABASE_URL` alone
 * must not create this backend. Ordinary commands use HTTP with the current
 * `PUZZLEHUNT_SERVICE_TOKEN` read per request and the `Service` authorization
 * scheme. Only the worker receives direct PostgreSQL stores.
 *
 * The bot starts the worker once on `clientReady`, independently of model-cache
 * or website access. Its guild loader fetches matching guild role/channel caches;
 * authorized inactive hunts are scanned as well as active ones. The opted-in
 * Discord client requires REST retries disabled; Fluid defaults remain unchanged.
 *
 * The five-connection pool requires session-affine advisory locks. Stop and settle
 * the worker before closing the pool. The service owns schema initialization;
 * construction does not initialize schema or start worker scans.
 */
export interface LocalPostgresBackend {
	readonly guildIds: readonly string[];
	readonly documents: HttpHuntDocumentClient;
	readonly worker: Pick<
		DurableIntegrationWorker,
		'start' | 'reconcile' | 'stop'
	>;
	/** Called only after worker.stop(). */
	close(): Promise<void>;
}

/** Call only after explicit local opt-in validation. The service owns schema initialization. */
export function createLocalPostgresBackend(
	config: LocalPostgresConfiguration,
	getGuild: (guildId: string) => Promise<Guild>,
	onError: (error: Error, scope?: HuntScope) => void
): LocalPostgresBackend {
	const pool = new Pool({
		connectionString: config.databaseUrl,
		max: 5,
		connectionTimeoutMillis: 10000,
	});
	pool.on('error', (error) => onError(error));
	const documents = new HttpHuntDocumentClient({
		baseUrl: config.serviceBaseUrl,
		authScheme: 'Service',
		getToken: () => readLocalServiceToken(process.env),
	});
	const worker = createDurableIntegrationWorker({
		documents: new PostgresPuzzlehuntStore(pool),
		integrations: new PostgresHuntIntegrationStore(pool),
		authorizedGuildIds: config.guildIds,
		getGuild,
		onError,
	});
	return {
		guildIds: config.guildIds,
		documents,
		worker,
		close: () => pool.end(),
	};
}

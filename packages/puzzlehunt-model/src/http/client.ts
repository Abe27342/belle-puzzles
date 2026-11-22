import { applyHuntStateUpdate, isUuid } from '../document.js';
import type {
	HuntCommandRequest,
	HuntCommandResult,
	HuntCollectionClient,
	HuntCreateRequest,
	HuntDocumentClient,
	HuntListing,
	HuntScope,
	HuntSnapshot,
	HuntStateUpdate,
} from '../document.js';
import {
	decodeHuntCommandResult,
	decodeHuntCommandUpdateResult,
	decodeHuntCreateRequest,
	decodeHuntListing,
	decodeHuntRejection,
	decodeHuntSnapshot,
	decodeHuntStateUpdate,
	HuntHttpError,
	HuntProtocolError,
} from './protocol.js';
import {
	HuntWatchCredentialError,
	watchHuntChanges,
	syncPuzzlehuntModel,
} from './changes.js';
import type {
	HuntChangeSubscription,
	HuntChangeWatchOptions,
	HuntModelSyncOptions,
} from './changes.js';
import type { PuzzlehuntModel } from '../model/puzzlehunt.js';
export { HuntHttpError } from './protocol.js';

export interface HttpHuntDocumentClientOptions {
	readonly baseUrl: string;
	/** Read credentials for each request; keep trusted-service credentials out of browsers. */
	readonly getToken: () => string | Promise<string>;
	readonly authScheme?: 'Bearer' | 'Service';
	readonly fetch?: typeof globalThis.fetch;
	readonly timeoutMs?: number;
}

export class HttpHuntDocumentClient
	implements HuntDocumentClient, HuntCollectionClient
{
	private readonly baseUrl: string;
	private readonly fetch: typeof globalThis.fetch;
	private readonly timeoutMs: number;
	private readonly snapshots = new Map<string, HuntSnapshot>();

	constructor(private readonly options: HttpHuntDocumentClientOptions) {
		const url = new URL(options.baseUrl);
		if (
			!['http:', 'https:'].includes(url.protocol) ||
			url.username ||
			url.password ||
			url.search ||
			url.hash
		) {
			throw new Error(
				'Expected an HTTP API base URL without credentials, query, or fragment.'
			);
		}
		this.baseUrl = `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
		this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
		this.timeoutMs = options.timeoutMs ?? 30000;
		if (
			!Number.isSafeInteger(this.timeoutMs) ||
			this.timeoutMs <= 0 ||
			this.timeoutMs > 2147483647
		) {
			throw new Error(
				'Expected a positive request timeout in milliseconds.'
			);
		}
	}

	async readActive(guildId: string): Promise<HuntSnapshot> {
		const snapshot = decodeHuntSnapshot(
			await this.request(`${this.guildPath(guildId)}/hunts/active`)
		);
		if (snapshot.guildId !== guildId) {
			throw new HuntProtocolError(
				'Active hunt response returned a different guild.'
			);
		}
		return this.cache(snapshot);
	}

	async create(
		guildId: string,
		request: HuntCreateRequest
	): Promise<HuntSnapshot> {
		const snapshot = decodeHuntSnapshot(
			await this.request(
				`${this.guildPath(guildId)}/hunts`,
				decodeHuntCreateRequest(request),
				'POST',
				201
			)
		);
		if (snapshot.guildId !== guildId) {
			throw new HuntProtocolError(
				'Created hunt response returned a different guild.'
			);
		}
		return this.cache(snapshot);
	}

	async list(guildId: string): Promise<HuntListing> {
		return decodeHuntListing(
			await this.request(`${this.guildPath(guildId)}/hunts`),
			guildId
		);
	}

	async selectActive(scope: HuntScope): Promise<HuntSnapshot> {
		this.huntPath(scope);
		return this.cache(
			decodeHuntSnapshot(
				await this.request(
					`${this.guildPath(scope.guildId)}/hunts/active`,
					{ huntId: scope.huntId },
					'PUT'
				),
				scope
			)
		);
	}

	async read(scope: HuntScope): Promise<HuntSnapshot> {
		const path = this.huntPath(scope);
		const base = this.snapshots.get(path);
		if (base) {
			const update = decodeHuntStateUpdate(
				await this.request(`${path}?since=${base.revision}`),
				scope
			);
			return this.assemble(base, update);
		}
		return this.cache(
			decodeHuntSnapshot(await this.request(path), scope)
		);
	}

	async submit(
		scope: HuntScope,
		request: HuntCommandRequest
	): Promise<HuntCommandResult> {
		const path = this.huntPath(scope);
		const base = this.snapshots.get(path);
		if (base) {
			const result = decodeHuntCommandUpdateResult(
				await this.request(
					`${path}/commands?since=${base.revision}`,
					request
				),
				scope,
				request.commandId
			);
			return {
				receipt: result.receipt,
				replayed: result.replayed,
				snapshot: await this.assemble(base, result.update),
			};
		}
		const result = decodeHuntCommandResult(
			await this.request(`${path}/commands`, request),
			scope,
			request.commandId
		);
		this.cache(result.snapshot);
		return result;
	}

	/** Opens the authenticated revision-hint stream without refreshing a model. */
	#watch(
		scope: HuntScope,
		options: HuntChangeWatchOptions
	): HuntChangeSubscription {
		const path = `${this.huntPath(scope)}/changes`;
		return watchHuntChanges(
			scope,
			async (signal) => {
				let authorization: string;
				try {
					authorization = await this.authorization();
				} catch (error) {
					throw new HuntWatchCredentialError(error);
				}
				signal.throwIfAborted();
				return this.fetch(`${this.baseUrl}${path}`, {
					method: 'GET',
					headers: {
						Accept: 'text/event-stream',
						Authorization: authorization,
					},
					cache: 'no-store',
					credentials: 'omit',
					redirect: 'error',
					signal,
				});
			},
			options
		);
	}

	/**
	 * Starts continuous synchronization of the supplied model with its opened hunt.
	 * Revision hints and recovery checks request queued refreshes; they never
	 * acknowledge or automatically retry commands.
	 *
	 * The returned subscription controls synchronization lifetime, not initial
	 * catch-up completion. Closing it removes observation/recovery hooks without
	 * flushing or disposing the model, or cancelling an already-running refresh.
	 */
	syncModel(
		model: PuzzlehuntModel,
		options: HuntModelSyncOptions
	): HuntChangeSubscription {
		return syncPuzzlehuntModel(
			(scope, watchOptions) => this.#watch(scope, watchOptions),
			model,
			options
		);
	}

	private cache(snapshot: HuntSnapshot): HuntSnapshot {
		const key = this.huntPath(snapshot);
		const previous = this.snapshots.get(key);
		if (!previous || snapshot.revision >= previous.revision) {
			this.snapshots.set(key, snapshot);
		}
		return snapshot;
	}

	private async assemble(
		base: HuntSnapshot,
		update: HuntStateUpdate
	): Promise<HuntSnapshot> {
		try {
			if (
				update.type === 'delta' &&
				update.delta.baseRevision !== base.revision
			) {
				// Recover state with a read, never by resubmitting the acknowledged command.
				update = {
					type: 'snapshot',
					snapshot: decodeHuntSnapshot(
						await this.request(this.huntPath(base)),
						base
					),
				};
			}
			return this.cache(applyHuntStateUpdate(base, update));
		} catch (error) {
			throw new HuntProtocolError(
				'Could not apply the authoritative hunt update.',
				{ cause: error }
			);
		}
	}

	private guildPath(guildId: string): string {
		if (typeof guildId !== 'string' || guildId.length === 0) {
			throw new Error('Expected a guild ID.');
		}
		return `/guilds/${encodeURIComponent(guildId)}`;
	}

	private huntPath(scope: HuntScope): string {
		if (!isUuid(scope.huntId)) {
			throw new Error('Expected a lowercase hunt UUID.');
		}
		return `${this.guildPath(scope.guildId)}/hunts/${scope.huntId}`;
	}

	private async request(
		path: string,
		body?: HuntCommandRequest | HuntCreateRequest | { huntId: string },
		method = body === undefined ? 'GET' : 'POST',
		successStatus = 200
	): Promise<unknown> {
		const authorization = await this.authorization();
		const response = await this.fetch(`${this.baseUrl}${path}`, {
			method,
			headers: {
				Accept: 'application/json',
				Authorization: authorization,
				...(body === undefined
					? {}
					: { 'Content-Type': 'application/json' }),
			},
			body: body === undefined ? undefined : JSON.stringify(body),
			cache: 'no-store',
			credentials: 'omit',
			redirect: 'error',
			signal: AbortSignal.timeout(this.timeoutMs),
		});
		if (response.status >= 500) {
			await response.body?.cancel();
			throw new HuntHttpError(response.status);
		}
		let value: unknown;
		try {
			if (
				response.headers
					.get('content-type')
					?.split(';')[0]
					.trim()
					.toLowerCase() !== 'application/json'
			) {
				await response.body?.cancel();
				throw new HuntProtocolError('Expected a JSON API response.');
			}
			value = await response.json();
		} catch (error) {
			throw new HuntProtocolError(
				'Could not decode the puzzlehunt API response.',
				{ cause: error }
			);
		}
		if (response.status !== successStatus) {
			throw (
				decodeHuntRejection(value, response.status) ??
				new HuntHttpError(response.status)
			);
		}
		return value;
	}

	private async authorization(): Promise<string> {
		const token = await this.options.getToken();
		if (typeof token !== 'string' || token.length === 0) {
			throw new Error('No puzzlehunt API credential is available.');
		}
		return `${this.options.authScheme ?? 'Bearer'} ${token}`;
	}
}

import { isDocumentId } from '../document.js';
import type {
	HuntCommandRequest,
	HuntCommandResult,
	HuntDocumentClient,
	HuntScope,
	HuntSnapshot,
} from '../document.js';
import {
	decodeHuntCommandResult,
	decodeHuntRejection,
	decodeHuntSnapshot,
	HuntProtocolError,
} from './protocol.js';

export interface HttpHuntDocumentClientOptions {
	readonly baseUrl: string;
	/** Read credentials for each request; keep trusted-service credentials out of browsers. */
	readonly getToken: () => string | Promise<string>;
	readonly authScheme?: 'Bearer' | 'Service';
	readonly fetch?: typeof globalThis.fetch;
	readonly timeoutMs?: number;
}

/** An HTTP failure without proof that a command was rejected before committing. */
export class HuntHttpError extends Error {
	constructor(public readonly status: number) {
		super(`Puzzlehunt API returned HTTP ${status}.`);
		this.name = 'HuntHttpError';
	}
}

export class HttpHuntDocumentClient implements HuntDocumentClient {
	private readonly baseUrl: string;
	private readonly fetch: typeof globalThis.fetch;
	private readonly timeoutMs: number;

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
		return snapshot;
	}

	async read(scope: HuntScope): Promise<HuntSnapshot> {
		return decodeHuntSnapshot(
			await this.request(this.huntPath(scope)),
			scope
		);
	}

	async submit(
		scope: HuntScope,
		request: HuntCommandRequest
	): Promise<HuntCommandResult> {
		return decodeHuntCommandResult(
			await this.request(`${this.huntPath(scope)}/commands`, request),
			scope,
			request.commandId
		);
	}

	private guildPath(guildId: string): string {
		if (typeof guildId !== 'string' || guildId.length === 0) {
			throw new Error('Expected a guild ID.');
		}
		return `/guilds/${encodeURIComponent(guildId)}`;
	}

	private huntPath(scope: HuntScope): string {
		if (!isDocumentId(scope.huntId)) {
			throw new Error('Expected a lowercase hunt UUID.');
		}
		return `${this.guildPath(scope.guildId)}/hunts/${scope.huntId}`;
	}

	private async request(
		path: string,
		command?: HuntCommandRequest
	): Promise<unknown> {
		const token = await this.options.getToken();
		if (typeof token !== 'string' || token.length === 0) {
			throw new Error('No puzzlehunt API credential is available.');
		}
		const response = await this.fetch(`${this.baseUrl}${path}`, {
			method: command === undefined ? 'GET' : 'POST',
			headers: {
				Accept: 'application/json',
				Authorization: `${
					this.options.authScheme ?? 'Bearer'
				} ${token}`,
				...(command === undefined
					? {}
					: { 'Content-Type': 'application/json' }),
			},
			body: command === undefined ? undefined : JSON.stringify(command),
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
		if (response.status !== 200) {
			throw (
				decodeHuntRejection(value, response.status) ??
				new HuntHttpError(response.status)
			);
		}
		return value;
	}
}

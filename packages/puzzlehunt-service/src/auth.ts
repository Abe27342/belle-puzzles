import { timingSafeEqual } from 'node:crypto';
import { HuntCommandError } from '@belle-puzzles/puzzlehunt-model/document';
import type { HuntAuthorizer } from './app.js';

export interface DiscordHuntAuthorizerOptions {
	readonly serviceToken?: string;
	readonly discordBotToken?: string;
	readonly fetch?: typeof globalThis.fetch;
}

function sameToken(left: string, right: string): boolean {
	const a = Buffer.from(left);
	const b = Buffer.from(right);
	return a.length === b.length && timingSafeEqual(a, b);
}

/** People prove guild membership through OAuth; a trusted bot is limited to its own guilds. */
export function createDiscordHuntAuthorizer(
	options: DiscordHuntAuthorizerOptions = {}
): HuntAuthorizer {
	if (options.serviceToken !== undefined && !options.discordBotToken) {
		throw new Error(
			'Trusted-service access requires the Discord bot credential.'
		);
	}
	const fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
	async function get(path: string, authorization: string): Promise<Response> {
		const response = await fetch(`https://discord.com/api/v10${path}`, {
			headers: { Authorization: authorization },
			redirect: 'error',
			signal: AbortSignal.timeout(10000),
		});
		if (response.status !== 200) {
			await response.body?.cancel();
		}
		return response;
	}
	return async (authorization, guildId) => {
		const credential = authorization?.match(/^(Bearer|Service) ([^\s]+)$/i);
		if (!credential) {
			throw new HuntCommandError(
				'unauthorized',
				'A Discord bearer token or service credential is required.'
			);
		}
		const [, scheme, token] = credential;
		if (!/^[0-9]{1,20}$/.test(guildId)) {
			throw new HuntCommandError(
				'invalid-command',
				'Expected a Discord guild ID.'
			);
		}
		if (scheme.toLowerCase() === 'service') {
			if (
				options.serviceToken === undefined ||
				!sameToken(token, options.serviceToken)
			) {
				throw new HuntCommandError(
					'unauthorized',
					'Invalid service credential.'
				);
			}
			const response = await get(
				`/guilds/${guildId}`,
				`Bot ${options.discordBotToken}`
			);
			if (response.status === 403 || response.status === 404) {
				throw new HuntCommandError(
					'forbidden',
					'The bot does not have access to this guild.'
				);
			}
			if (response.status !== 200) {
				throw new Error(
					`Discord bot guild authorization failed (HTTP ${response.status}).`
				);
			}
			const guild: unknown = await response.json();
			if (
				typeof guild !== 'object' ||
				guild === null ||
				!('id' in guild) ||
				guild.id !== guildId
			) {
				throw new Error('Discord returned an invalid guild response.');
			}
			return;
		}
		if (
			options.serviceToken !== undefined &&
			sameToken(token, options.serviceToken)
		) {
			throw new HuntCommandError(
				'unauthorized',
				'Trusted-bot credentials require Service authorization.'
			);
		}
		let after = '0';
		for (;;) {
			const response = await get(
				`/users/@me/guilds?limit=200&after=${after}`,
				`Bearer ${token}`
			);
			if (response.status === 401) {
				throw new HuntCommandError(
					'unauthorized',
					'The Discord token is invalid or expired.'
				);
			}
			if (response.status === 403) {
				throw new HuntCommandError(
					'forbidden',
					'The Discord token requires the guilds OAuth scope.'
				);
			}
			if (response.status !== 200) {
				throw new Error(
					`Discord user guild authorization failed (HTTP ${response.status}).`
				);
			}
			const guilds: unknown = await response.json();
			if (!Array.isArray(guilds)) {
				throw new Error('Discord returned an invalid guild list.');
			}
			const ids: string[] = [];
			for (const guild of guilds) {
				if (
					typeof guild !== 'object' ||
					guild === null ||
					!('id' in guild) ||
					typeof guild.id !== 'string' ||
					!/^[0-9]{1,20}$/.test(guild.id)
				) {
					throw new Error('Discord returned an invalid guild list.');
				}
				ids.push(guild.id);
			}
			if (ids.includes(guildId)) {
				return;
			}
			if (ids.length < 200) {
				throw new HuntCommandError(
					'forbidden',
					'You are not a member of this guild.'
				);
			}
			const last = ids[ids.length - 1];
			if (BigInt(last) <= BigInt(after)) {
				throw new Error('Discord guild pagination did not advance.');
			}
			after = last;
		}
	};
}

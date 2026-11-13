import { describe, expect, it, vi } from 'vitest';
import { HuntCommandError } from '@belle-puzzles/puzzlehunt-model/document';
import { createDiscordHuntAuthorizer } from '../auth.js';

const json = (value: unknown, status = 200) =>
	new Response(JSON.stringify(value), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
const serviceToken = 'test-only-trusted-service-credential';

describe('Discord hunt authorization', () => {
	it('accepts any guild member using the existing guilds OAuth scope', async () => {
		const fetch = vi.fn<typeof globalThis.fetch>(async () =>
			json([{ id: '123' }])
		);
		await createDiscordHuntAuthorizer({ fetch })(
			'Bearer user-token',
			'123'
		);
		expect(fetch.mock.calls[0][0]).toBe(
			'https://discord.com/api/v10/users/@me/guilds?limit=200&after=0'
		);
		expect(fetch.mock.calls[0][1]).toMatchObject({
			headers: { Authorization: 'Bearer user-token' },
			redirect: 'error',
		});
	});

	it('paginates rather than denying members with many guilds', async () => {
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockResolvedValueOnce(
				json(
					Array.from({ length: 200 }, (_, i) => ({
						id: String(i + 1),
					}))
				)
			)
			.mockResolvedValueOnce(json([{ id: '201' }]));
		await createDiscordHuntAuthorizer({ fetch })(
			'Bearer user-token',
			'201'
		);
		expect(fetch.mock.calls[1][0]).toContain('after=200');
	});

	it.each([undefined, '', 'Basic token', 'Bearer two tokens'])(
		'rejects missing or malformed credentials %#',
		async (header) => {
			const fetch = vi.fn<typeof globalThis.fetch>();
			await expect(
				createDiscordHuntAuthorizer({ fetch })(header, '123')
			).rejects.toMatchObject({ code: 'unauthorized' });
			expect(fetch).not.toHaveBeenCalled();
		}
	);

	it('does not trust a guild supplied without membership proof', async () => {
		const fetch = vi.fn<typeof globalThis.fetch>(async () =>
			json([{ id: '456' }])
		);
		await expect(
			createDiscordHuntAuthorizer({ fetch })('Bearer user-token', '123')
		).rejects.toMatchObject({ code: 'forbidden' });
	});

	it.each([
		[401, 'unauthorized'],
		[403, 'forbidden'],
	] as const)(
		'maps Discord %i to a definitive %s rejection',
		async (status, code) => {
			const fetch = vi.fn<typeof globalThis.fetch>(async () =>
				json({}, status)
			);
			await expect(
				createDiscordHuntAuthorizer({ fetch })(
					'Bearer user-token',
					'123'
				)
			).rejects.toMatchObject({ code });
		}
	);

	it.each([429, 500])(
		'surfaces Discord unavailability (%i), not a false permission denial',
		async (status) => {
			const fetch = vi.fn<typeof globalThis.fetch>(async () =>
				json({}, status)
			);
			await expect(
				createDiscordHuntAuthorizer({ fetch })(
					'Bearer user-token',
					'123'
				)
			).rejects.not.toBeInstanceOf(HuntCommandError);
		}
	);

	it('checks the configured bot membership for a separate service credential', async () => {
		const fetch = vi.fn<typeof globalThis.fetch>(async () =>
			json({ id: '123' })
		);
		const authorize = createDiscordHuntAuthorizer({
			serviceToken,
			discordBotToken: 'bot-token',
			fetch,
		});
		await authorize(`Service ${serviceToken}`, '123');
		expect(fetch.mock.calls[0][0]).toBe(
			'https://discord.com/api/v10/guilds/123'
		);
		expect(fetch.mock.calls[0][1]?.headers).toEqual({
			Authorization: 'Bot bot-token',
		});
	});

	it.each([403, 404])(
		'limits trusted-bot requests to accessible guilds (%i)',
		async (status) => {
			const fetch = vi.fn<typeof globalThis.fetch>(async () =>
				json({}, status)
			);
			const authorize = createDiscordHuntAuthorizer({
				serviceToken,
				discordBotToken: 'bot-token',
				fetch,
			});
			await expect(
				authorize(`Service ${serviceToken}`, '123')
			).rejects.toMatchObject({ code: 'forbidden' });
		}
	);

	it('does not downgrade invalid server bot configuration to a client rejection', async () => {
		const fetch = vi.fn<typeof globalThis.fetch>(async () => json({}, 401));
		const authorize = createDiscordHuntAuthorizer({
			serviceToken,
			discordBotToken: 'bot-token',
			fetch,
		});
		await expect(
			authorize(`Service ${serviceToken}`, '123')
		).rejects.not.toBeInstanceOf(HuntCommandError);
	});

	it('requires the bot credential before enabling trusted-service access', () => {
		expect(() => createDiscordHuntAuthorizer({ serviceToken })).toThrow(
			'requires the Discord bot credential'
		);
	});

	it.each(['Service invalid-service-token', `Bearer ${serviceToken}`])(
		'never forwards service credentials to Discord as OAuth tokens (%#)',
		async (header) => {
			const fetch = vi.fn<typeof globalThis.fetch>();
			const authorize = createDiscordHuntAuthorizer({
				serviceToken,
				discordBotToken: 'bot-token',
				fetch,
			});
			await expect(authorize(header, '123')).rejects.toMatchObject({
				code: 'unauthorized',
			});
			expect(fetch).not.toHaveBeenCalled();
		}
	);
});

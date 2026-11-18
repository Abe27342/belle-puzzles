import { describe, expect, it, vi } from 'vitest';
import { HuntCommandError } from '@belle-puzzles/puzzlehunt-model/document';
import { createDiscordHuntAuthorizer } from '../app.js';

const json = (value: unknown, status = 200) =>
	new Response(JSON.stringify(value), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
const serviceToken = 'test-only-trusted-service-credential';
const discordClientId = '456';
const authorizationInfo = () => json({ application: { id: discordClientId } });

describe('Discord hunt authorization', () => {
	it('accepts any guild member using the existing guilds OAuth scope', async () => {
		const fetch = vi
			.fn<typeof globalThis.fetch>(async () => json([{ id: '123' }]))
			.mockResolvedValueOnce(authorizationInfo());
		await createDiscordHuntAuthorizer({ discordClientId, fetch })(
			'Bearer user-token',
			'123'
		);
		expect(fetch.mock.calls[0][0]).toBe(
			'https://discord.com/api/v10/oauth2/@me'
		);
		expect(fetch.mock.calls[1][0]).toBe(
			'https://discord.com/api/v10/users/@me/guilds?limit=200&after=0'
		);
		for (const [, request] of fetch.mock.calls) {
			expect(request).toMatchObject({
				headers: { Authorization: 'Bearer user-token' },
				redirect: 'error',
			});
		}
	});

	it('paginates rather than denying members with many guilds', async () => {
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockResolvedValueOnce(authorizationInfo())
			.mockResolvedValueOnce(
				json(
					Array.from({ length: 200 }, (_, i) => ({
						id: String(i + 1),
					}))
				)
			)
			.mockResolvedValueOnce(json([{ id: '201' }]));
		await createDiscordHuntAuthorizer({ discordClientId, fetch })(
			'Bearer user-token',
			'201'
		);
		expect(fetch.mock.calls[2][0]).toContain('after=200');
	});

	it.each([undefined, '', 'Basic token', 'Bearer two tokens'])(
		'rejects missing or malformed credentials %#',
		async (header) => {
			const fetch = vi.fn<typeof globalThis.fetch>();
			await expect(
				createDiscordHuntAuthorizer({ discordClientId, fetch })(
					header,
					'123'
				)
			).rejects.toMatchObject({ code: 'unauthorized' });
			expect(fetch).not.toHaveBeenCalled();
		}
	);

	it('does not trust a guild supplied without membership proof', async () => {
		const fetch = vi
			.fn<typeof globalThis.fetch>(async () => json([{ id: '456' }]))
			.mockResolvedValueOnce(authorizationInfo());
		await expect(
			createDiscordHuntAuthorizer({ discordClientId, fetch })(
				'Bearer user-token',
				'123'
			)
		).rejects.toMatchObject({ code: 'forbidden' });
	});

	it.each([
		[401, 'unauthorized'],
		[403, 'forbidden'],
	] as const)(
		'maps Discord %i to a definitive %s rejection',
		async (status, code) => {
			const fetch = vi
				.fn<typeof globalThis.fetch>(async () => json({}, status))
				.mockResolvedValueOnce(authorizationInfo());
			await expect(
				createDiscordHuntAuthorizer({ discordClientId, fetch })(
					'Bearer user-token',
					'123'
				)
			).rejects.toMatchObject({ code });
		}
	);

	it.each([429, 500])(
		'surfaces Discord unavailability (%i), not a false permission denial',
		async (status) => {
			const fetch = vi
				.fn<typeof globalThis.fetch>(async () => json({}, status))
				.mockResolvedValueOnce(authorizationInfo());
			await expect(
				createDiscordHuntAuthorizer({ discordClientId, fetch })(
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
			discordClientId,
			serviceToken,
			discordBotToken: 'bot-token',
			fetch,
		});
		await authorize(`Service ${serviceToken}`, '123');
		expect(fetch).toHaveBeenCalledOnce();
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
				discordClientId,
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
			discordClientId,
			serviceToken,
			discordBotToken: 'bot-token',
			fetch,
		});
		await expect(
			authorize(`Service ${serviceToken}`, '123')
		).rejects.not.toBeInstanceOf(HuntCommandError);
	});

	it('requires the bot credential before enabling trusted-service access', () => {
		expect(() =>
			createDiscordHuntAuthorizer({ discordClientId, serviceToken })
		).toThrow('requires the Discord bot credential');
	});

	it.each(['Service invalid-service-token', `Bearer ${serviceToken}`])(
		'never forwards service credentials to Discord as OAuth tokens (%#)',
		async (header) => {
			const fetch = vi.fn<typeof globalThis.fetch>();
			const authorize = createDiscordHuntAuthorizer({
				discordClientId,
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

	it('rejects another application before looking up guild memberships', async () => {
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockResolvedValueOnce(json({ application: { id: '789' } }))
			.mockResolvedValueOnce(json([{ id: '123' }]));
		await expect(
			createDiscordHuntAuthorizer({ discordClientId, fetch })(
				'Bearer other-app-token',
				'123'
			)
		).rejects.toMatchObject({ code: 'unauthorized' });
		expect(fetch).toHaveBeenCalledExactlyOnceWith(
			'https://discord.com/api/v10/oauth2/@me',
			expect.objectContaining({
				headers: { Authorization: 'Bearer other-app-token' },
			})
		);
	});

	it.each([{}, { application: null }, { application: { id: 456 } }])(
		'surfaces malformed authorization information rather than accepting it (%j)',
		async (information) => {
			const fetch = vi.fn<typeof globalThis.fetch>(async () =>
				json(information)
			);
			await expect(
				createDiscordHuntAuthorizer({ discordClientId, fetch })(
					'Bearer user-token',
					'123'
				)
			).rejects.not.toBeInstanceOf(HuntCommandError);
			expect(fetch).toHaveBeenCalledOnce();
		}
	);

	it.each([
		[401, 'unauthorized'],
		[403, 'forbidden'],
	] as const)(
		'rejects failed OAuth authorization (%i) before reading memberships',
		async (status, code) => {
			const fetch = vi.fn<typeof globalThis.fetch>(async () =>
				json({}, status)
			);
			await expect(
				createDiscordHuntAuthorizer({ discordClientId, fetch })(
					'Bearer user-token',
					'123'
				)
			).rejects.toMatchObject({ code });
			expect(fetch).toHaveBeenCalledOnce();
		}
	);

	it.each([429, 500])(
		'surfaces OAuth information unavailability (%i), not a permission denial',
		async (status) => {
			const fetch = vi.fn<typeof globalThis.fetch>(async () =>
				json({}, status)
			);
			await expect(
				createDiscordHuntAuthorizer({ discordClientId, fetch })(
					'Bearer user-token',
					'123'
				)
			).rejects.not.toBeInstanceOf(HuntCommandError);
			expect(fetch).toHaveBeenCalledOnce();
		}
	);

	it('requires an OAuth application ID when constructing the authorizer', () => {
		expect(() =>
			createDiscordHuntAuthorizer({ discordClientId: '' })
		).toThrow('Discord OAuth client ID is required');
	});
});

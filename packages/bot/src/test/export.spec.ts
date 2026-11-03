import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChannelType, Routes, type APIMessage } from 'discord.js';
import {
	discoverHunt,
	listGuilds,
	parseHuntMetadata,
	type DiscordReader,
} from '../export/discord.js';
import {
	exportPuzzlehunts,
	type ExportDependencies,
	type ExportManifest,
} from '../export/exporter.js';

const botId = '99';
const metadata = {
	name: 'Example hunt',
	fluidFileId: 'document-1',
	googleFolderId: 'folder-1',
	indexId: '21',
	allPuzzlesRoleId: '22',
	extraConfig: { preserved: true },
};
const message: Pick<
	APIMessage,
	'id' | 'channel_id' | 'pinned' | 'content' | 'edited_timestamp'
> & { author: { id: string } } = {
	id: '30',
	channel_id: '20',
	author: { id: botId },
	pinned: true,
	content: JSON.stringify(metadata),
	edited_timestamp: null,
};
const pin = { pinned_at: '2026-01-02T03:04:05.000Z', message };
const adminChannel = {
	id: '20',
	name: 'belle-bot-admin',
	type: ChannelType.GuildText,
};

function fakeDiscord(
	handle: (
		route: `/${string}`,
		query: URLSearchParams
	) => unknown | Promise<unknown>
): DiscordReader {
	return {
		get: vi.fn(async (route, options) => {
			if (route === Routes.user('@me')) {
				return { id: botId, bot: true };
			}
			return handle(route, options?.query ?? new URLSearchParams());
		}),
	};
}

function defaultDiscord(): DiscordReader {
	return fakeDiscord((route) => {
		switch (route) {
			case Routes.userGuilds():
				return [
					{ id: '1', name: 'Has hunt' },
					{ id: '2', name: 'No hunt' },
				];
			case Routes.guildChannels('1'):
				return [adminChannel];
			case Routes.guildChannels('2'):
				return [];
			case Routes.channelMessagesPins('20'):
				return { items: [pin], has_more: false };
			case Routes.channelMessage('20', '30'):
				return message;
			default:
				throw new Error(`Unexpected Discord read: ${route}`);
		}
	});
}

describe('hunt export inventory', () => {
	let parent: string;
	let output: string;
	let dependencies: ExportDependencies;

	beforeEach(async () => {
		parent = await mkdtemp(join(tmpdir(), 'belle-export-test-'));
		output = join(parent, 'snapshot');
		dependencies = {
			botId,
			discord: defaultDiscord(),
			fluidSource: { endpoint: 'http://localhost:7070' },
			loadSnapshot: vi.fn(async () => ({
				capturedAt: '2026-01-02T03:04:06.000Z',
				state: { guildId: '1', rootIds: [], nodes: [] },
			})),
		};
	});

	afterEach(async () => {
		await rm(parent, { recursive: true, force: true });
	});

	it('writes versioned state, pinned configuration and a complete all-guild manifest', async () => {
		const manifest = await exportPuzzlehunts(output, dependencies);
		expect(manifest.complete).toBe(true);
		expect(manifest.guildDiscoveryComplete).toBe(true);
		expect(manifest.counts).toEqual({
			discovered: 2,
			exported: 1,
			noHunt: 1,
			failed: 0,
		});
		expect(manifest.guilds.map((guild) => guild.status)).toEqual([
			'exported',
			'no-hunt',
		]);
		expect(
			JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'))
		).toEqual(manifest);
		const exported = JSON.parse(
			await readFile(join(output, '1.json'), 'utf8')
		);
		expect(exported).toMatchObject({
			format: 'belle-puzzlehunt-export',
			schemaVersion: 1,
			exportId: manifest.exportId,
			capturedAt: '2026-01-02T03:04:06.000Z',
			metadata,
			source: {
				guild: { id: '1', name: 'Has hunt' },
				fluid: {
					documentId: 'document-1',
					model: '@fluid-experimental/tree',
					writeFormat: '0.1.1',
				},
				adminMessage: {
					channelId: '20',
					messageId: '30',
					authorId: botId,
					content: message.content,
					editedAt: null,
				},
			},
			state: { guildId: '1', rootIds: [], nodes: [] },
		});
		expect(await readdir(output)).toEqual(['1.json', 'manifest.json']);
	});

	it('persists an incomplete manifest before loading any documents', async () => {
		dependencies.loadSnapshot = async () => {
			const manifest: ExportManifest = JSON.parse(
				await readFile(join(output, 'manifest.json'), 'utf8')
			);
			expect(manifest.status).toBe('running');
			expect(manifest.complete).toBe(false);
			throw new Error('Document unavailable');
		};
		const manifest = await exportPuzzlehunts(output, dependencies);
		expect(manifest.complete).toBe(false);
		expect(manifest.guildDiscoveryComplete).toBe(true);
		expect(manifest.counts).toEqual({
			discovered: 2,
			exported: 0,
			noHunt: 1,
			failed: 1,
		});
		expect(manifest.guilds[0]).toMatchObject({
			status: 'failed',
			metadata,
			failure: {
				stage: 'load-document',
				message: 'Document unavailable',
			},
		});
		expect(await readdir(output)).toEqual(['manifest.json']);
	});

	it('does not overwrite even an empty existing export directory', async () => {
		await exportPuzzlehunts(output, dependencies);
		const previous = await readFile(join(output, 'manifest.json'), 'utf8');
		const unusedDiscord = fakeDiscord(() => {
			throw new Error('Must not access Discord');
		});
		await expect(
			exportPuzzlehunts(output, {
				...dependencies,
				discord: unusedDiscord,
			})
		).rejects.toMatchObject({ code: 'EEXIST' });
		expect(unusedDiscord.get).not.toHaveBeenCalled();
		expect(await readFile(join(output, 'manifest.json'), 'utf8')).toBe(
			previous
		);
	});

	it('marks authentication and guild-list failures incomplete, not zero-guild success', async () => {
		dependencies.discord = {
			get: vi.fn(async () => ({ id: '98', bot: true })),
		};
		let manifest = await exportPuzzlehunts(output, dependencies);
		expect(manifest.complete).toBe(false);
		expect(manifest.failures[0].stage).toBe('authentication');
		output = join(parent, 'list-failure');
		dependencies.discord = fakeDiscord(() => {
			throw new Error('Guild discovery unavailable');
		});
		manifest = await exportPuzzlehunts(output, dependencies);
		expect(manifest.complete).toBe(false);
		expect(manifest.guildDiscoveryComplete).toBe(false);
		expect(manifest.failures).toEqual([
			{ stage: 'list-guilds', message: 'Guild discovery unavailable' },
		]);
	});

	it.each(['permission', 'context-change', 'guild-mismatch'])(
		'reports %s failures and continues inventorying other guilds',
		async (scenario) => {
			const discord = defaultDiscord();
			dependencies.discord = {
				get: async (route, options) => {
					if (
						scenario === 'permission' &&
						route === Routes.guildChannels('1')
					) {
						throw new Error('Missing Access');
					}
					if (
						scenario === 'context-change' &&
						route === Routes.channelMessage('20', '30')
					) {
						return { ...message, content: '{}' };
					}
					return discord.get(route, options);
				},
			};
			if (scenario === 'guild-mismatch') {
				dependencies.loadSnapshot = async () => ({
					capturedAt: new Date().toISOString(),
					state: { guildId: 'another-guild', rootIds: [], nodes: [] },
				});
			}
			const manifest = await exportPuzzlehunts(output, dependencies);
			expect(manifest.complete).toBe(false);
			expect(manifest.guilds.map((guild) => guild.status)).toEqual([
				'failed',
				'no-hunt',
			]);
			expect(manifest.guilds[0].failure.stage).toBe(
				scenario === 'permission'
					? 'discover-hunt'
					: scenario === 'context-change'
					? 'verify-context'
					: 'load-document'
			);
			expect(await readdir(output)).toEqual(['manifest.json']);
		}
	);

	it('preserves partial inventory if a later guild page cannot be fetched', async () => {
		dependencies.discord = fakeDiscord((route, query) => {
			if (route !== Routes.userGuilds()) {
				return [];
			}
			if (query.has('after')) {
				throw new Error('Second guild page failed');
			}
			return Array.from({ length: 200 }, (_, i) => ({
				id: `${i + 1}`,
				name: `Guild ${i + 1}`,
			}));
		});
		const manifest = await exportPuzzlehunts(output, dependencies);
		expect(manifest.counts).toEqual({
			discovered: 200,
			noHunt: 200,
			exported: 0,
			failed: 0,
		});
		expect(manifest.complete).toBe(false);
		expect(manifest.guildDiscoveryComplete).toBe(false);
		expect(manifest.failures[0]).toEqual({
			stage: 'list-guilds',
			message: 'Second guild page failed',
		});
	});
});

describe('read-only Discord discovery', () => {
	it('enumerates guild membership beyond the 200-guild page limit', async () => {
		const discord = fakeDiscord((route, query) => {
			expect(route).toBe(Routes.userGuilds());
			expect(query.get('limit')).toBe('200');
			return query.has('after')
				? [{ id: '201', name: 'Last guild' }]
				: Array.from({ length: 200 }, (_, i) => ({
						id: `${i + 1}`,
						name: `Guild ${i + 1}`,
				  }));
		});
		const guilds = [];
		for await (const guild of listGuilds(discord)) {
			guilds.push(guild);
		}
		expect(guilds).toHaveLength(201);
		expect(guilds[200].id).toBe('201');
		expect(discord.get).toHaveBeenLastCalledWith(Routes.userGuilds(), {
			query: new URLSearchParams({ limit: '200', after: '200' }),
		});
	});

	it('searches all pinned-message pages, ignoring other authors', async () => {
		const discord = fakeDiscord((route, query) => {
			if (route === Routes.guildChannels('1')) {
				return [adminChannel];
			}
			expect(route).toBe(Routes.channelMessagesPins('20'));
			if (!query.has('before')) {
				return {
					items: [
						{
							...pin,
							message: { ...message, author: { id: '98' } },
						},
					],
					has_more: true,
				};
			}
			expect(query.get('before')).toBe(pin.pinned_at);
			return {
				items: [{ ...pin, pinned_at: '2026-01-01T00:00:00.000Z' }],
				has_more: false,
			};
		});
		expect(await discoverHunt(discord, '1', botId)).toMatchObject({
			status: 'found',
			metadata,
			adminMessage: { messageId: '30' },
		});
	});

	it.each([
		'duplicate-channel',
		'missing-pin',
		'duplicate-pin',
		'bad-json',
		'nonadvancing-pins',
	])('rejects ambiguous/incomplete discovery: %s', async (scenario) => {
		const discord = fakeDiscord((route) => {
			if (route === Routes.guildChannels('1')) {
				return scenario === 'duplicate-channel'
					? [adminChannel, { ...adminChannel, id: '21' }]
					: [adminChannel];
			}
			return {
				items:
					scenario === 'missing-pin'
						? []
						: scenario === 'duplicate-pin'
						? [pin, { ...pin, message: { ...message, id: '31' } }]
						: scenario === 'bad-json'
						? [
								{
									...pin,
									message: {
										...message,
										content: 'not JSON',
									},
								},
						  ]
						: [pin],
				has_more: scenario === 'nonadvancing-pins',
			};
		});
		await expect(discoverHunt(discord, '1', botId)).rejects.toThrow();
	});

	it('preserves optional-field absence, empty values and additional configuration', () => {
		expect(parseHuntMetadata(JSON.stringify(metadata))).toEqual(metadata);
		const minimal = parseHuntMetadata(
			'{"name":"","fluidFileId":"id","indexId":""}'
		);
		expect(minimal).toEqual({ name: '', fluidFileId: 'id', indexId: '' });
		expect(minimal).not.toHaveProperty('googleFolderId');
		expect(() =>
			parseHuntMetadata(
				'{"name":"hunt","fluidFileId":"id","indexId":null}'
			)
		).toThrow();
	});
});

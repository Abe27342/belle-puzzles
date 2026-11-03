import { ChannelType, Routes } from 'discord.js';

export interface DiscordReader {
	get(
		route: `/${string}`,
		options?: { query: URLSearchParams }
	): Promise<unknown>;
}

export interface ExportGuild {
	id: string;
	name: string;
}

export interface HuntMetadata extends Record<string, unknown> {
	fluidFileId: string;
	name: string;
	googleFolderId?: string;
	indexId?: string;
	allPuzzlesRoleId?: string;
}

export interface AdminMessageSource {
	channelId: string;
	messageId: string;
	authorId: string;
	pinnedAt: string;
	editedAt: string | null;
	content: string;
}

export type HuntDiscovery =
	| { status: 'no-hunt' }
	| {
			status: 'found';
			metadata: HuntMetadata;
			adminMessage: AdminMessageSource;
	  };

function object(value: unknown): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('Expected a JSON object.');
	}
	return value as Record<string, unknown>;
}

function string(value: unknown, field: string): string {
	if (typeof value !== 'string') {
		throw new Error(`Expected a string for ${field}.`);
	}
	return value;
}

function snowflake(value: unknown, field: string): string {
	const id = string(value, field);
	if (!/^\d+$/.test(id)) {
		throw new Error(`Invalid Discord ID for ${field}.`);
	}
	return id;
}

function array(value: unknown): unknown[] {
	if (!Array.isArray(value)) {
		throw new Error('Expected a JSON array.');
	}
	return value;
}

export async function verifyBot(
	discord: DiscordReader,
	expectedBotId: string
): Promise<void> {
	const user = object(await discord.get(Routes.user('@me')));
	if (user.bot !== true || user.id !== expectedBotId) {
		throw new Error(
			'DISCORD_TOKEN does not belong to the configured CLIENT_ID bot.'
		);
	}
}

export async function* listGuilds(
	discord: DiscordReader
): AsyncIterable<ExportGuild> {
	let after: string | undefined;
	const seen = new Set<string>();
	while (true) {
		const query = new URLSearchParams({ limit: '200' });
		if (after !== undefined) {
			query.set('after', after);
		}
		const page = array(await discord.get(Routes.userGuilds(), { query }));
		for (const entry of page) {
			const guild = object(entry);
			const id = snowflake(guild.id, 'guild.id');
			if (
				seen.has(id) ||
				(after !== undefined && BigInt(id) <= BigInt(after))
			) {
				throw new Error(
					'Guild pagination repeated or moved behind its cursor.'
				);
			}
			seen.add(id);
			yield { id, name: string(guild.name, 'guild.name') };
		}
		if (page.length < 200) {
			return;
		}
		after = snowflake(object(page[page.length - 1]).id, 'guild.id');
	}
}

export function parseHuntMetadata(content: string): HuntMetadata {
	const data = object(JSON.parse(content));
	const fluidFileId = string(data.fluidFileId, 'fluidFileId');
	if (fluidFileId.length === 0) {
		throw new Error('fluidFileId must not be empty.');
	}
	const name = string(data.name, 'name');
	for (const field of ['googleFolderId', 'indexId', 'allPuzzlesRoleId']) {
		if (field in data) {
			string(data[field], field);
		}
	}
	return { ...data, fluidFileId, name };
}

export async function discoverHunt(
	discord: DiscordReader,
	guildId: string,
	botId: string
): Promise<HuntDiscovery> {
	const channels = array(await discord.get(Routes.guildChannels(guildId)))
		.map(object)
		.filter((channel) => channel.name === 'belle-bot-admin');
	if (channels.length === 0) {
		return { status: 'no-hunt' };
	}
	if (channels.length !== 1) {
		throw new Error('Multiple belle-bot-admin channels were found.');
	}
	const channel = channels[0];
	if (
		channel.type !== ChannelType.GuildText &&
		channel.type !== ChannelType.GuildAnnouncement
	) {
		throw new Error('belle-bot-admin is not a supported message channel.');
	}
	const channelId = snowflake(channel.id, 'channel.id');
	const messages = new Map<string, AdminMessageSource>();
	let before: string | undefined;
	while (true) {
		const query = new URLSearchParams({ limit: '50' });
		if (before !== undefined) {
			query.set('before', before);
		}
		const page = object(
			await discord.get(Routes.channelMessagesPins(channelId), { query })
		);
		const items = array(page.items);
		let cursor: string | undefined;
		for (const entry of items) {
			const item = object(entry);
			cursor = string(item.pinned_at, 'pinned_at');
			const message = object(item.message);
			const author = object(message.author);
			if (author.id === botId) {
				const source = readAdminMessage(message, channelId, cursor);
				messages.set(source.messageId, source);
			}
		}
		if (typeof page.has_more !== 'boolean') {
			throw new Error('Pinned-message pagination omitted has_more.');
		}
		if (!page.has_more) {
			break;
		}
		if (
			cursor === undefined ||
			!Number.isFinite(Date.parse(cursor)) ||
			(before !== undefined && Date.parse(cursor) >= Date.parse(before))
		) {
			throw new Error('Pinned-message pagination failed to advance.');
		}
		before = cursor;
	}
	if (messages.size !== 1) {
		throw new Error(
			`Expected one Belle-authored pinned hunt context; found ${messages.size}.`
		);
	}
	const adminMessage = messages.values().next().value;
	return {
		status: 'found',
		metadata: parseHuntMetadata(adminMessage.content),
		adminMessage,
	};
}

function readAdminMessage(
	message: Record<string, unknown>,
	channelId: string,
	pinnedAt: string
): AdminMessageSource {
	if (message.channel_id !== channelId || message.pinned !== true) {
		throw new Error(
			'The hunt context is not pinned in the expected channel.'
		);
	}
	const editedAt =
		message.edited_timestamp === null
			? null
			: string(message.edited_timestamp, 'edited_timestamp');
	return {
		channelId,
		messageId: snowflake(message.id, 'message.id'),
		authorId: snowflake(object(message.author).id, 'author.id'),
		pinnedAt,
		editedAt,
		content: string(message.content, 'message.content'),
	};
}

export async function verifyHuntContext(
	discord: DiscordReader,
	source: AdminMessageSource
): Promise<void> {
	const message = readAdminMessage(
		object(
			await discord.get(
				Routes.channelMessage(source.channelId, source.messageId)
			)
		),
		source.channelId,
		source.pinnedAt
	);
	if (
		message.authorId !== source.authorId ||
		message.content !== source.content ||
		message.editedAt !== source.editedAt
	) {
		throw new Error(
			'The pinned hunt context changed during the export; rerun.'
		);
	}
}

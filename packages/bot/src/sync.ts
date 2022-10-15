import {
	ChannelType,
	Guild,
	Message,
	OverwriteData,
	OverwriteType,
	TextChannel,
} from 'discord.js';
import {
	assert,
	BELLE_USER_ID,
	EmbedContent,
	generatePuzzleEmbed,
	generateRoundEmbed,
	getAncestorRounds,
} from './utils/index.js';
import type {
	IPuzzlehunt,
	Puzzle,
	Round,
} from '@belle-puzzles/puzzlehunt-model';
import { PermissionsBitField, Role } from 'discord.js';
import { PuzzlehuntContext } from './types.js';
import { createGoogleSheet } from './integrations/google.js';

export const createDiscordAssociation = (
	context: PuzzlehuntContext,
	guild: Guild,
	puzzleObj: Puzzle | Round
): Promise<void> => {
	return puzzleObj.type === 'puzzle'
		? createPuzzleChannel(context, guild, puzzleObj)
		: createRoundChannels(context, guild, puzzleObj);
};

export const removeDiscordAssociation = async (
	guild: Guild,
	puzzleObj: Puzzle | Round
): Promise<void> => {
	const { discordInfo } = puzzleObj;
	if (!discordInfo) {
		return;
	}

	const { indexChannelId, roleId, channelId } = discordInfo;
	const tasks = [
		guild.roles.delete(roleId),
		guild.channels.delete(channelId),
	];
	if (indexChannelId) {
		tasks.push(guild.channels.delete(indexChannelId));
	}
	await Promise.all(tasks);
};

const createPuzzleChannel = async (
	context: PuzzlehuntContext,
	guild: Guild,
	puzzle: Puzzle
) => {
	const { puzzlehunt } = context;
	const { name, roundId } = puzzle;
	const parent = puzzlehunt.getRound(roundId);
	const role = await guild.roles.create({
		name,
		mentionable: false,
	});

	const channel = await guild.channels.create({
		name,
		parent: parent.discordInfo.channelId,
		permissionOverwrites: getViewPermissions(context, puzzle, role),
	});
	puzzlehunt.augmentWithDiscord(puzzle, { role, channel });
};

const createRoundChannels = async (
	context: PuzzlehuntContext,
	guild: Guild,
	round: Round
) => {
	const { puzzlehunt, allPuzzlesRoleId, indexId } = context;
	const { name } = round;

	const role = await guild.roles.create({
		name,
		mentionable: false,
	});

	console.log(
		`adding channel in guild ${puzzlehunt.guildId} with permissions ${role.id} and ${allPuzzlesRoleId}`
	);
	const permissionOverwrites = getViewPermissions(context, round, role);
	console.log(
		'Adding permissionOverrides',
		JSON.stringify(
			permissionOverwrites.map((val) => ({
				id: typeof val.id === 'string' ? val.id : val.id.id,
			}))
		)
	);
	const [categoryChannel, indexChannel] = await Promise.all([
		guild.channels.create({
			type: ChannelType.GuildCategory,
			name,
			permissionOverwrites,
		}),
		guild.channels.create({
			name: `${name}-puzzles`,
			parent: indexId,
			permissionOverwrites: [
				{
					id: guild.id,
					deny: [PermissionsBitField.Flags.SendMessages],
					type: OverwriteType.Role,
				},
				{
					id: BELLE_USER_ID,
					allow: [PermissionsBitField.Flags.SendMessages],
					type: OverwriteType.Member,
				},
			],
		}),
	]);

	puzzlehunt.augmentWithDiscord(round, {
		role,
		channel: categoryChannel,
		indexChannel,
	});
};

export async function syncRoles(
	context: PuzzlehuntContext,
	guild: Guild,
	puzzleObj: Round | Puzzle
): Promise<void> {
	const channel = guild.channels.cache.get(puzzleObj.discordInfo.channelId);
	const permissionOverwrites = getViewPermissions(
		context,
		puzzleObj,
		puzzleObj.discordInfo.roleId
	);
	assert(
		channel.type === ChannelType.GuildText ||
			channel.type === ChannelType.GuildCategory,
		'Puzzle channel should be text or category.'
	);

	const currentOverwrites = channel.permissionOverwrites.cache;
	const hasEquivalentPermissions = () => {
		if (permissionOverwrites.length !== currentOverwrites.size) {
			return false;
		}

		for (const overwrite of permissionOverwrites) {
			const current = currentOverwrites.get(
				typeof overwrite.id === 'string'
					? overwrite.id
					: overwrite.id.id
			);

			if (
				!current ||
				current.allow.bitfield !==
					PermissionsBitField.resolve(overwrite.allow ?? []) ||
				current.deny.bitfield !==
					PermissionsBitField.resolve(overwrite.deny ?? [])
				// Don't bother comparing types. Only changes whether override is for a role or member, but id comparison there is sufficient.
				// current.type !== overwrite.type
			) {
				return false;
			}
		}
		return true;
	};

	if (!hasEquivalentPermissions()) {
		await channel.permissionOverwrites.set(permissionOverwrites);
	}
}

export const syncChannel = (
	context: PuzzlehuntContext,
	guild: Guild,
	puzzleObj: Puzzle | Round
): Promise<void> => {
	return puzzleObj.type === 'puzzle'
		? syncPuzzleChannel(guild, puzzleObj)
		: syncRoundChannels(context.puzzlehunt, guild, puzzleObj);
};

async function syncPuzzleChannel(guild: Guild, puzzle: Puzzle): Promise<void> {
	const channel = guild.channels.cache.get(puzzle.discordInfo.channelId);
	assert(
		channel.type === ChannelType.GuildText,
		'Expected puzzle to have a text channel.'
	);

	const updateChannelName = async () => {
		let expectedChannelName = puzzle.name
			.toLocaleLowerCase()
			.replaceAll(' ', '-')
			.replace(/[^a-z0-9\-]/g, '');
		if (puzzle.answer !== undefined) {
			expectedChannelName = `solved-${expectedChannelName}`;
		}
		if (channel.name !== expectedChannelName) {
			await channel.setName(expectedChannelName);
		}
	};
	const updatePuzzleEmbed = updateEmbedFactory(
		channel,
		generatePuzzleEmbed(puzzle)
	);

	await Promise.all([updateChannelName(), updatePuzzleEmbed()]);
}

async function syncRoundChannels(
	puzzlehunt: IPuzzlehunt,
	guild: Guild,
	round: Round
): Promise<void> {
	const indexChannel = guild.channels.cache.get(
		round.discordInfo.indexChannelId
	);
	assert(
		indexChannel.type === ChannelType.GuildText,
		'Expected round index channel to be a text channel.'
	);
	const channel = guild.channels.cache.get(round.discordInfo.channelId);
	assert(
		channel.type === ChannelType.GuildCategory,
		'Expected round to have a category channel.'
	);

	const updateIndex = updateEmbedFactory(
		indexChannel,
		generateRoundEmbed(round, puzzlehunt)
	);
	const updateCategoryChannelName = async () => {
		let expectedChannelName = round.name
			.toLocaleLowerCase()
			.replaceAll(' ', '-');
		if (channel.name !== expectedChannelName) {
			await channel.setName(expectedChannelName);
		}
	};

	const updateIndexChannelName = async () => {
		let expectedChannelName = `${round.name
			.toLocaleLowerCase()
			.replaceAll(' ', '-')}-puzzles`;
		if (indexChannel.name !== expectedChannelName) {
			await indexChannel.setName(expectedChannelName);
		}
	};

	await Promise.all([
		updateIndex(),
		updateCategoryChannelName(),
		updateIndexChannelName(),
	]);
}

const updateEmbedFactory =
	(channel: TextChannel, embedData: EmbedContent): (() => Promise<void>) =>
	async () => {
		await channel.messages.fetchPinned();
		const message = findEmbed(channel);
		if (message !== undefined) {
			if (
				message.embeds.length !== embedData.embeds.length ||
				message.embeds
					.map((embed, i) => ({
						embed,
						embedOther: embedData.embeds[i],
					}))
					.some(({ embed, embedOther }) => {
						// Note: this method is highly custom w.r.t the content of the embeds we generate.
						// If the embeds use more features than title / fields / description, it needs to be
						// updated.
						const { data: other } = embedOther;
						const otherFields = other.fields ?? [];
						let fieldsAreEquivalent: boolean =
							embed.fields.length === otherFields.length;
						if (
							embed.fields.length > 0 &&
							otherFields.length > 0 &&
							embed.fields.length === otherFields.length
						) {
							for (let i = 0; i < embed.fields.length; i++) {
								if (
									embed.fields[i].name !==
										otherFields[i].name ||
									embed.fields[i].value !==
										otherFields[i].value
								) {
									fieldsAreEquivalent = false;
									break;
								}
							}
						}
						// TODO: Need some kind of batched write to make sure we only POST most recent data.
						// Alternatively use really fine-grained inval.
						return (
							embed.title !== other.title ||
							embed.description?.trim() !==
								other.description?.trim() ||
							!fieldsAreEquivalent
						);
					})
			) {
				await message.edit(embedData);
			}
		} else {
			const message = await channel.send(embedData);
			await message.pin();
		}
	};

function findEmbed(channel: TextChannel): Message {
	return channel.messages.cache.find(
		(message) => message.author.id === BELLE_USER_ID && message.pinned
	);
}

function getViewPermissions(
	context: PuzzlehuntContext,
	puzzleObj: Puzzle | Round,
	puzzleObjRole: Role | string
): OverwriteData[] {
	const { puzzlehunt, allPuzzlesRoleId } = context;
	const allowRoles = [puzzleObjRole, allPuzzlesRoleId];
	if (puzzleObj.roundId) {
		const parent = puzzlehunt.getRound(puzzleObj.roundId);
		allowRoles.push(
			...getAncestorRounds(puzzlehunt, parent).map(
				(round) => round.discordInfo.roleId
			)
		);
	}

	// Specifying type here probably shouldn't be necessary, but some issues on discord.js suggest it may be
	// (see e.g. https://github.com/discordjs/discord.js/issues/8686).
	return [
		{
			id: BELLE_USER_ID,
			allow: [PermissionsBitField.Flags.ViewChannel],
			type: OverwriteType.Member,
		},
		{
			id: puzzlehunt.guildId,
			deny: [PermissionsBitField.Flags.ViewChannel],
			type: OverwriteType.Role,
		},
		...allowRoles.map((role) => ({
			id: role,
			allow: [PermissionsBitField.Flags.ViewChannel],
			type: OverwriteType.Role,
		})),
	];
}

export async function resyncServerFull(
	context: PuzzlehuntContext,
	guild: Guild
): Promise<void> {
	const { puzzlehunt } = context;
	const puzzles = Array.from(puzzlehunt.puzzles);
	let allPuzzleObj = [...puzzles, ...puzzlehunt.rounds];
	// First ensure all sheets and discord channels are created
	await Promise.all([
		...allPuzzleObj
			.filter((obj) => !obj.discordInfo)
			.map((obj) => createDiscordAssociation(context, guild, obj)),
		...puzzles
			.filter((puzzle) => !puzzle.sheetId)
			.map(async (puzzle) => {
				const sheetId = await createGoogleSheet(
					puzzle.name,
					context.googleFolderId
				);
				context.puzzlehunt.augmentWithGoogleSheet(puzzle, sheetId);
			}),
	]);

	// Then verify all embeds / roles are up-to-date. In theory this should happen already
	// because of the listeners on the above events modifying the fluid file.
	// Recreate all of the puzzleObj handles, since they may now be populated with discord information.
	allPuzzleObj = [...puzzlehunt.puzzles, ...puzzlehunt.rounds];
	await Promise.all([
		...allPuzzleObj.map((obj) => syncChannel(context, guild, obj)),
		...allPuzzleObj.map((obj) => syncRoles(context, guild, obj)),
	]);
}

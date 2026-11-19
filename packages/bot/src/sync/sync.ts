import {
	ChannelType,
	DiscordAPIError,
	Guild,
	Message,
	OverwriteData,
	OverwriteType,
	StringSelectMenuComponent,
	TextChannel,
} from 'discord.js';
import {
	assert,
	BELLE_USER_ID,
	EmbedContent,
	generatePuzzleEmbed,
	generateRoundEmbed,
	getAncestorRounds,
} from '../utils/index.js';
import type {
	DiscordPuzzleInfo,
	DiscordRoundInfo,
	DocumentNode,
	Puzzle,
	Round,
} from '@belle-puzzles/puzzlehunt-model';
import { PermissionsBitField, Role } from 'discord.js';
import { PuzzlehuntContext } from '../puzzlehunt-context.js';
import { createGoogleSheet } from '../integrations/google.js';
import { puzzleAddedMessage } from './logs.js';

export type PuzzlehuntSyncContext = Pick<
	PuzzlehuntContext,
	'puzzlehunt' | 'googleFolderId' | 'indexId' | 'allPuzzlesRoleId'
>;

async function settleSync(tasks: readonly Promise<unknown>[]): Promise<void> {
	const settled = await Promise.allSettled(tasks);
	const failed = settled.find((result) => result.status === 'rejected');
	if (failed?.status === 'rejected') throw failed.reason;
}

export const createDiscordAssociation = async (
	context: PuzzlehuntSyncContext,
	guild: Guild,
	puzzleObj: Puzzle | Round
): Promise<void> => {
	const { puzzlehunt } = context;
	if (puzzleObj.type === 'puzzle') {
		const parent = puzzlehunt.getRound(puzzleObj.parentId);
		const discordInfo = await provisionDiscordResources(
			context,
			guild,
			puzzleObj
		);
		if (puzzlehunt.loggingChannelIds) {
			const { puzzleAdd } = puzzlehunt.loggingChannelIds;
			const channel = guild.channels.cache.get(puzzleAdd);
			if (channel?.isTextBased()) {
				await channel.send(
					puzzleAddedMessage(parent.name, puzzleObj.name)
				);
			}
		}

		puzzlehunt.augmentWithDiscord(puzzleObj, discordInfo);
	} else {
		puzzlehunt.augmentWithDiscord(
			puzzleObj,
			await provisionDiscordResources(context, guild, puzzleObj)
		);
	}
};

export async function createGoogleSheetAssociation(
	context: PuzzlehuntSyncContext,
	puzzle: Puzzle
): Promise<void> {
	const sheetId = await createGoogleSheet(
		puzzle.name,
		context.googleFolderId
	);
	context.puzzlehunt.augmentWithGoogleSheet(puzzle, sheetId);
}

/**
 * Provisioning and association persistence for change execution and full reconciliation.
 *
 * @remarks
 * Callbacks must finish persistence and make associations visible in the model before
 * resolving, so puzzle provisioning can use round associations. The default callbacks
 * from {@link createSyncProvisioning} retain Fluid's direct augmentation and puzzle-add
 * logging. Solve/status logging remains in the Fluid commands.
 *
 * Durable callers must supply callbacks that complete associations through their trusted
 * task boundary rather than using the Fluid-facing wrappers.
 */
export interface SyncProvisioning {
	/**
	 * Provision and associate a node's Discord resources.
	 *
	 * @remarks
	 * {@link provisionDiscordResources} returns association data without writing the model
	 * or emitting puzzle-add logs. Use {@link DiscordProvisioningOptions} to persist
	 * confirmed external IDs and reuse them on retries.
	 */
	discord(node: Puzzle | Round): Promise<void>;
	/**
	 * Provision and associate a puzzle's Google Sheet.
	 *
	 * @remarks
	 * {@link createGoogleSheet} copies the sheet separately from persistence. A durable
	 * caller must save its returned ID and reuse it rather than copying again on retry,
	 * then complete the association through its trusted task boundary.
	 * {@link createGoogleSheetAssociation} is the Fluid-facing wrapper.
	 */
	googleSheet(puzzle: Puzzle): Promise<void>;
}

/** Fluid-facing persistence and puzzle-add logging; workers supply their own callbacks. */
export function createSyncProvisioning(
	context: PuzzlehuntSyncContext,
	guild: Guild
): SyncProvisioning {
	return {
		discord: (node) => createDiscordAssociation(context, guild, node),
		googleSheet: (puzzle) => createGoogleSheetAssociation(context, puzzle),
	};
}

/**
 * Checkpointing for external Discord resource creation.
 *
 * @remarks
 * Round channels are created concurrently; merge each confirmed field independently
 * and reuse it on retries. Both channel attempts and their checkpoints settle before a
 * round provisioning failure is returned. External creation is not exactly-once: a crash
 * after a Discord request succeeds but before its ID is persisted can still leave an orphan.
 */
export interface DiscordProvisioningOptions {
	/** Previously confirmed resources to reuse, without creating replacements. */
	readonly existing?: Partial<Record<keyof DiscordRoundInfo, string>>;
	/**
	 * Await persistence of each confirmed external ID before proceeding.
	 */
	readonly onCreated?: (
		resource: keyof DiscordRoundInfo,
		id: string
	) => Promise<void>;
}

/** Create external resources only, without association writes or puzzle-add logs. */
export function provisionDiscordResources(
	context: PuzzlehuntSyncContext,
	guild: Guild,
	node: Puzzle,
	options?: DiscordProvisioningOptions
): Promise<DiscordPuzzleInfo>;
export function provisionDiscordResources(
	context: PuzzlehuntSyncContext,
	guild: Guild,
	node: Round,
	options?: DiscordProvisioningOptions
): Promise<DiscordRoundInfo>;
export function provisionDiscordResources(
	context: PuzzlehuntSyncContext,
	guild: Guild,
	node: Puzzle | Round,
	options?: DiscordProvisioningOptions
): Promise<DiscordPuzzleInfo | DiscordRoundInfo>;
export function provisionDiscordResources(
	context: PuzzlehuntSyncContext,
	guild: Guild,
	node: Puzzle | Round,
	options: DiscordProvisioningOptions = {}
): Promise<DiscordPuzzleInfo | DiscordRoundInfo> {
	return node.type === 'puzzle'
		? createPuzzleChannel(context, guild, node, options)
		: createRoundChannels(context, guild, node, options);
}

async function provisionDiscordResource(
	resource: keyof DiscordRoundInfo,
	options: DiscordProvisioningOptions,
	create: () => Promise<{ id: string }>
): Promise<string> {
	const existing = options.existing?.[resource];
	if (existing !== undefined) {
		return existing;
	}
	const { id } = await create();
	await options.onCreated?.(resource, id);
	return id;
}

export const removeDiscordAssociation = async (
	guild: Guild,
	puzzleObj: DocumentNode
): Promise<void> => {
	const { discord: discordInfo } = puzzleObj;
	if (!discordInfo) {
		return;
	}

	const { indexChannelId, roleId, channelId } = discordInfo;
	const remove = async (operation: Promise<unknown>) => {
		try {
			await operation;
		} catch (error) {
			// Discord's unknown-channel/unknown-role responses make tombstone retries safe.
			if (
				!(error instanceof DiscordAPIError) ||
				![10003, 10011].includes(Number(error.code))
			) {
				throw error;
			}
		}
	};
	const tasks = [
		remove(guild.roles.delete(roleId)),
		remove(guild.channels.delete(channelId)),
	];
	if (indexChannelId) {
		tasks.push(remove(guild.channels.delete(indexChannelId)));
	}
	await settleSync(tasks);
};

const createPuzzleChannel = async (
	context: PuzzlehuntSyncContext,
	guild: Guild,
	puzzle: Puzzle,
	options: DiscordProvisioningOptions
): Promise<DiscordPuzzleInfo> => {
	const { puzzlehunt } = context;
	const { name, parentId } = puzzle;
	const parent = puzzlehunt.getRound(parentId);
	const role = await provisionDiscordResource('role', options, () =>
		guild.roles.create({
			name,
			mentionable: false,
		})
	);

	const channel = await provisionDiscordResource('channel', options, () =>
		guild.channels.create({
			name,
			parent: parent.discord.channelId,
			permissionOverwrites: getViewPermissions(context, puzzle, role),
		})
	);

	return { role, channel };
};

const createRoundChannels = async (
	context: PuzzlehuntSyncContext,
	guild: Guild,
	round: Round,
	options: DiscordProvisioningOptions
): Promise<DiscordRoundInfo> => {
	const { puzzlehunt, allPuzzlesRoleId, indexId } = context;
	const { name } = round;

	const role = await provisionDiscordResource('role', options, () =>
		guild.roles.create({
			name,
			mentionable: false,
		})
	);

	console.log(
		`adding channel in guild ${puzzlehunt.guildId} with permissions ${role} and ${allPuzzlesRoleId}`
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
	// Settle both checkpoints before surfacing a failure so retries can reuse either result.
	const [categoryChannel, indexChannel] = await Promise.allSettled([
		provisionDiscordResource('channel', options, () =>
			guild.channels.create({
				type: ChannelType.GuildCategory,
				name,
				permissionOverwrites,
			})
		),
		provisionDiscordResource('indexChannel', options, () =>
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
			})
		),
	]);
	if (categoryChannel.status === 'rejected') {
		throw categoryChannel.reason;
	}
	if (indexChannel.status === 'rejected') {
		throw indexChannel.reason;
	}

	return {
		role,
		channel: categoryChannel.value,
		indexChannel: indexChannel.value,
	};
};

export async function syncRoles(
	context: PuzzlehuntSyncContext,
	guild: Guild,
	puzzleObj: Round | Puzzle
): Promise<void> {
	const channel = guild.channels.cache.get(puzzleObj.discord.channelId);
	const permissionOverwrites = getViewPermissions(
		context,
		puzzleObj,
		puzzleObj.discord.roleId
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
	context: PuzzlehuntSyncContext,
	guild: Guild,
	puzzleObj: Puzzle | Round
): Promise<void> => {
	return puzzleObj.type === 'puzzle'
		? syncPuzzleChannel(context, guild, puzzleObj)
		: syncRoundChannels(context, guild, puzzleObj);
};

async function syncPuzzleChannel(
	context: PuzzlehuntSyncContext,
	guild: Guild,
	puzzle: Puzzle
): Promise<void> {
	const channel = guild.channels.cache.get(puzzle.discord.channelId);
	assert(
		channel.type === ChannelType.GuildText,
		'Expected puzzle to have a text channel.'
	);

	const updateChannelName = async () => {
		let expectedChannelName = puzzle.name
			.toLocaleLowerCase()
			.replaceAll(' ', '-');
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
	const updateParent = async () => {
		const parentId = context.puzzlehunt.getRound(puzzle.parentId).discord
			.channelId;
		if (channel.parentId !== parentId) {
			await channel.setParent(parentId, { lockPermissions: false });
		}
	};

	await settleSync([
		updateChannelName(),
		updatePuzzleEmbed(),
		updateParent(),
	]);
}

async function syncRoundChannels(
	context: PuzzlehuntSyncContext,
	guild: Guild,
	round: Round
): Promise<void> {
	const indexChannel = guild.channels.cache.get(round.discord.indexChannelId);
	assert(
		indexChannel.type === ChannelType.GuildText,
		'Expected round index channel to be a text channel.'
	);
	const channel = guild.channels.cache.get(round.discord.channelId);
	assert(
		channel.type === ChannelType.GuildCategory,
		'Expected round to have a category channel.'
	);

	const updateIndex = updateEmbedFactory(
		indexChannel,
		generateRoundEmbed(round, context.puzzlehunt)
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

	await settleSync([
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
			const component = message.resolveComponent('makePuzzleVisible');
			// Note: ideally this check would be better, but for now it's only necessary for it to be good
			// enough to detect edits need to happen after exceeding capacity. If no component found,
			const puzzleOptionsAreDifferent =
				component instanceof StringSelectMenuComponent &&
				component.options.length !==
					(embedData.components[0].components[0] as any).options
						?.length;

			if (
				puzzleOptionsAreDifferent ||
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

/** Permission updates resolve ancestor roles from the current model. */
function getViewPermissions(
	context: PuzzlehuntSyncContext,
	puzzleObj: Puzzle | Round,
	puzzleObjRole: Role | string
): OverwriteData[] {
	const { puzzlehunt, allPuzzlesRoleId } = context;
	const allowRoles = [puzzleObjRole, allPuzzlesRoleId];
	if (puzzleObj.parentId !== undefined) {
		const parent = puzzlehunt.getRound(puzzleObj.parentId);
		allowRoles.push(
			...getAncestorRounds(puzzlehunt, parent).map(
				(round) => round.discord.roleId
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

/**
 * Reconcile current model state without requiring historical change events.
 *
 * @remarks
 * Provisions only missing associations, then refreshes all existing channels, embeds,
 * and permissions through the model-based helpers. Existing associations are
 * synchronized, not recreated. Without removal snapshots,
 * this cannot discover orphaned resources belonging to nodes already deleted.
 */
export async function resyncServerFull(
	context: PuzzlehuntSyncContext,
	guild: Guild,
	provisioning: SyncProvisioning = createSyncProvisioning(context, guild)
): Promise<void> {
	const { puzzlehunt } = context;
	const puzzles = Array.from(puzzlehunt.puzzles);
	// First ensure all sheets and discord channels are created
	// Provision rounds in parallel before creating puzzle resources.
	// This ensures puzzle channels can be parented under their round's category.
	await Promise.all(
		Array.from(puzzlehunt.rounds)
			.filter((round) => !round.discord)
			.map((round) => provisioning.discord(round))
	);
	await Promise.all([
		...puzzles
			.filter((obj) => !obj.discord)
			.map((obj) => provisioning.discord(obj)),
		...puzzles
			.filter((puzzle) => !puzzle.sheetId)
			.map((puzzle) => provisioning.googleSheet(puzzle)),
	]);

	// Then verify all embeds / roles are up-to-date. In theory this should happen already
	// because of the listeners on the above events modifying the fluid file.
	// Recreate all of the puzzleObj handles, since they may now be populated with discord information.
	const allPuzzleObj = [...puzzlehunt.puzzles, ...puzzlehunt.rounds];
	await settleSync(
		allPuzzleObj.map((obj) => syncCurrentNode(context, guild, obj))
	);
}

/** Shared derived-state repair; callers may select a bounded subset on each pass. */
export async function syncCurrentNode(
	context: PuzzlehuntSyncContext,
	guild: Guild,
	node: Puzzle | Round
): Promise<void> {
	await settleSync([
		syncChannel(context, guild, node),
		syncRoles(context, guild, node),
	]);
}

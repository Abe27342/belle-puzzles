import { Guild } from 'discord.js';
import type { PuzzlehuntContext } from '../puzzlehunt-context.js';
import type {
	PuzzlehuntChangeEvent,
	DocumentNode,
	Round,
	Puzzle,
} from '@belle-puzzles/puzzlehunt-model';
import {
	createDiscordAssociation,
	syncRoles,
	syncChannel,
	removeDiscordAssociation,
} from './sync.js';
import { createGoogleSheet } from '../integrations/google.js';

export function makeViewChangeHandler(
	context: PuzzlehuntContext,
	getGuild: () => Guild
): (event: PuzzlehuntChangeEvent) => Promise<void> {
	const resolveNode = (node: DocumentNode): Puzzle | Round =>
		node.type === 'puzzle'
			? context.puzzlehunt.getPuzzle(node.id)
			: context.puzzlehunt.getRound(node.id);
	return async ({ after, changes }) => {
		const guild = getGuild();
		const nodes = new Map<string, DocumentNode>(
			[...after.rounds, ...after.puzzles].map((node) => [node.id, node])
		);
		const channelsToSync = new Set<string>(/* document node id_s */);
		const rolesToSync = new Set<string>(/* document node id_s */);
		// TODO: Need a task queue to ensure concurrent tasks don't cause issues. If there is overlap between create/delete
		// current code likely can into issues.
		const tasks: Promise<void>[] = [];
		const refreshParent = (node: DocumentNode) => {
			if (node.parentId !== undefined) {
				channelsToSync.add(node.parentId);
			}
		};

		const refreshRoles = (node: DocumentNode) => {
			rolesToSync.add(node.id);
			for (const child of after.rounds.find(
				(round) => round.id === node.id
			)?.children ?? []) {
				refreshRoles(child);
			}
		};

		for (const change of changes) {
			if (change.type === 'node-removed') {
				// Note: we explicitly don't delete google sheets here, since it's riskier in case the delete
				// was an accident.
				tasks.push(removeDiscordAssociation(guild, change.node));
				refreshParent(change.node);
			} else if (change.type === 'node-added') {
				channelsToSync.add(change.node.id);
				refreshParent(change.node);
			} else {
				channelsToSync.add(change.after.id);
				refreshParent(change.before);
				refreshParent(change.after);
				if (
					change.before.parentId !== change.after.parentId ||
					change.before.discord?.roleId !==
						change.after.discord?.roleId
				) {
					refreshRoles(change.after);
				}
				if (
					change.before.discord?.indexChannelId !==
					change.after.discord?.indexChannelId
				) {
					// Embeds have a reference to their parent round.
					// This ensures that reference remains valid on index channel changes
					// (though I don't think user interaction flows ever currently cause an index channel
					// to be recreated)
					for (const round of after.rounds.filter(
						(round) => round.parentId === change.after.id
					)) {
						channelsToSync.add(round.id);
					}
				}
			}
		}
		await Promise.all(tasks);
		tasks.length = 0;

		const added = new Set(
			changes
				.filter((change) => change.type === 'node-added')
				.map((change) => change.node.id)
		);
		// Provision rounds in parallel before creating puzzle resources.
		await Promise.all(
			after.rounds
				.filter((node) => added.has(node.id) && !node.discord)
				.map((node) =>
					createDiscordAssociation(context, guild, resolveNode(node))
				)
		);
		for (const node of after.puzzles.filter((node) => added.has(node.id))) {
			if (!node.discord) {
				tasks.push(
					createDiscordAssociation(context, guild, resolveNode(node))
				);
			}
			if (!node.sheetId) {
				tasks.push(
					createGoogleSheet(node.name, context.googleFolderId).then(
						(id) => {
							context.puzzlehunt.augmentWithGoogleSheet(node, id);
						}
					)
				);
			}
		}

		await Promise.all([
			...tasks,
			...Array.from(channelsToSync, (id) => {
				const node = nodes.get(id);
				return node?.discord
					? syncChannel(context, guild, resolveNode(node))
					: undefined;
			}),
			...Array.from(rolesToSync, (id) => {
				const node = nodes.get(id);
				return node?.discord
					? syncRoles(context, guild, resolveNode(node))
					: undefined;
			}),
		]);
	};
}

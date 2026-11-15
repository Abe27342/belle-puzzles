import { Guild } from 'discord.js';
import type { PuzzlehuntContext } from '../puzzlehunt-context.js';
import type {
	PuzzlehuntChangeEvent,
	DocumentNode,
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
	return async ({ after, changes }) => {
		const guild = getGuild();
		const nodes = new Map<string, DocumentNode>(
			[...after.rounds, ...after.puzzles].map((node) => [node.id, node])
		);
		const channels = new Set<string>();
		const roles = new Set<string>();
		// TODO: Need a task queue to ensure concurrent tasks don't cause issues. If there is overlap between create/delete
		// current code likely can into issues.
		const tasks: Promise<void>[] = [];
		// TODO: Handle channel drag n drop
		const refreshParent = (node: DocumentNode) => {
			if (node.parentId !== null) {
				channels.add(node.parentId);
			}
		};
		// Random musing, but a lot of this code might be cleaner by a proper dependency system.
		const refreshRoles = (node: DocumentNode) => {
			roles.add(node.id);
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
				channels.add(change.node.id);
				refreshParent(change.node);
			} else {
				channels.add(change.after.id);
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
					for (const round of after.rounds.filter(
						(round) => round.parentId === change.after.id
					)) {
						channels.add(round.id);
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
		// Provision parents before their children, including whole added subtrees.
		for (const node of after.rounds.filter((node) => added.has(node.id))) {
			if (!node.discord) {
				await createDiscordAssociation(context, guild, node, after);
			}
		}
		for (const node of after.puzzles.filter((node) => added.has(node.id))) {
			if (!node.discord) {
				tasks.push(
					createDiscordAssociation(context, guild, node, after)
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
			...Array.from(channels, (id) => {
				const node = nodes.get(id);
				return node?.discord
					? syncChannel(context, guild, node, after)
					: undefined;
			}),
			...Array.from(roles, (id) => {
				const node = nodes.get(id);
				return node?.discord
					? syncRoles(context, guild, node, after)
					: undefined;
			}),
		]);
	};
}

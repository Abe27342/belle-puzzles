import { NodeId, TreeView } from '@fluid-experimental/tree';
import { assert } from '../utils/index.js';
import { Guild } from 'discord.js';
import type { PuzzlehuntContext } from '../puzzlehunt-context.js';
import {
	Puzzle,
	Round,
	StringNode,
	NumberNode,
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
): (
	before: TreeView,
	after: TreeView,
	getHandle: (
		view: TreeView,
		id: NodeId
	) => StringNode | NumberNode | Puzzle | Round | undefined
) => Promise<void> {
	const { puzzlehunt } = context;
	const viewChangeHandler = async (
		before: TreeView,
		after: TreeView,
		// Can return undefined when it's the root note that changed (ex: new root round added)
		getHandle: (
			view: TreeView,
			id: NodeId
		) => StringNode | NumberNode | Puzzle | Round | undefined
	) => {
		const guild = getGuild();
		const delta = before.delta(after);
		const added = delta.added.map((id) => getHandle(after, id));

		const addedNodeIds = new Set(delta.added);
		// TODO: Do something with removed here.
		// TODO: Handle channel drag n drop
		const removed = delta.removed.map((id) => getHandle(before, id));
		const changed = delta.changed.map((id) => ({
			before: getHandle(before, id),
			after: getHandle(after, id),
		}));

		const tasks: Promise<void>[] = [];
		// Note: we explicitly don't delete google sheets here, since it's riskier in case the delete
		// was an accident.
		for (const node of removed) {
			if (node.type === 'puzzle' || node.type === 'round') {
				tasks.push(removeDiscordAssociation(guild, node));
			}
		}

		for (const node of added) {
			if (node.type === 'puzzle' && !node.sheetId) {
				const task = createGoogleSheet(
					node.name,
					context.googleFolderId
				).then((id) => {
					puzzlehunt.augmentWithGoogleSheet(node, id);
				});
				tasks.push(task);
			}

			if (
				(node.type === 'puzzle' || node.type === 'round') &&
				!node.discordInfo
			) {
				tasks.push(createDiscordAssociation(context, guild, node));
			}
		}

		// TODO: Need a task queue to ensure concurrent tasks don't cause issues. If there is overlap between create/delete
		// current code likely can into issues.
		const discordObjectsToSync = new Set<NodeId>();

		// Observation: all operations that we need to act on will show up on the "changed" map,
		// since they're edits of existing rounds/puzzles.
		for (const { after: node, before: beforeNode } of changed) {
			if (node === undefined) {
				continue;
			}

			if (node.type === 'string' || node.type === 'number') {
				// Note: I guess this could reasonably fire for re-solving a puzzle with an existing answer
				// if we went for setPayload instead. But it shouldn't happen now.
				console.log(`Unexpected change fired for ${node.type} handle.`);
			} else if (node.discordInfo) {
				discordObjectsToSync.add(node.id);
				if (node.roundId) {
					discordObjectsToSync.add(node.roundId);
				}
			}

			// Moving a node to a new parent in the tree causes the old and new parents to show up in `changed`.
			// In this case we need to update the role assignments on the puzzle to reflect the new tree structure.
			// Random musing, but a lot of this code might be cleaner by a proper dependency system.
			if (
				node.type === 'round' &&
				beforeNode.type === 'round' &&
				node.children.length !== beforeNode.children.length
			) {
				const oldChildren = new Set(
					beforeNode.children.map((child) => child.id)
				);
				const movedChildren = node.children.filter(
					(child) =>
						!oldChildren.has(child.id) &&
						!addedNodeIds.has(child.id)
				);
				tasks.push(
					...movedChildren.map((child) =>
						syncRoles(context, guild, child)
					)
				);
			}
		}
		await Promise.all([
			...Array.from(discordObjectsToSync, (id) => {
				const obj = getHandle(after, id);
				assert(
					obj.type === 'puzzle' || obj.type === 'round',
					'Expected only puzzles and rounds to sync.'
				);
				return syncChannel(context, guild, obj);
			}),
			...tasks,
		]);
	};

	return viewChangeHandler;
}

import { Guild } from 'discord.js';
import type { PuzzlehuntContext } from '../puzzlehunt-context.js';
import type {
	PuzzlehuntChangeEvent,
	DocumentNode,
	Round,
	Puzzle,
} from '@belle-puzzles/puzzlehunt-model';
import {
	createSyncProvisioning,
	syncRoles,
	syncChannel,
	removeDiscordAssociation,
	type SyncProvisioning,
} from './sync.js';

export interface PuzzlehuntSyncWork {
	readonly removedNodes: readonly DocumentNode[];
	readonly addedRounds: readonly Round[];
	readonly addedPuzzles: readonly Puzzle[];
	readonly channelsToSync: readonly DocumentNode[];
	readonly rolesToSync: readonly DocumentNode[];
}

/** Calculate affected work without external operations or model mutations. */
export function calculateChangeWork({
	after,
	changes,
}: PuzzlehuntChangeEvent): PuzzlehuntSyncWork {
	const nodes = new Map<string, DocumentNode>(
		[...after.rounds, ...after.puzzles].map((node) => [node.id, node])
	);
	const channelsToSync = new Set<string>(/* document node id_s */);
	const rolesToSync = new Set<string>(/* document node id_s */);
	const removedNodes: DocumentNode[] = [];
	const refreshParent = (node: DocumentNode) => {
		if (node.parentId !== undefined) {
			channelsToSync.add(node.parentId);
		}
	};

	const refreshRoles = (node: DocumentNode) => {
		rolesToSync.add(node.id);
		for (const child of after.rounds.find((round) => round.id === node.id)
			?.children ?? []) {
			refreshRoles(child);
		}
	};

	for (const change of changes) {
		if (change.type === 'node-removed') {
			removedNodes.push(change.node);
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
				change.before.discord?.roleId !== change.after.discord?.roleId
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

	const added = new Set(
		changes
			.filter((change) => change.type === 'node-added')
			.map((change) => change.node.id)
	);
	const resolveNodes = (ids: Set<string>): DocumentNode[] =>
		Array.from(ids).flatMap((id) => {
			const node = nodes.get(id);
			return node === undefined ? [] : [node];
		});
	return {
		removedNodes,
		addedRounds: after.rounds.filter((node) => added.has(node.id)),
		addedPuzzles: after.puzzles.filter((node) => added.has(node.id)),
		channelsToSync: resolveNodes(channelsToSync),
		rolesToSync: resolveNodes(rolesToSync),
	};
}

export function makeViewChangeHandler(
	context: PuzzlehuntContext,
	getGuild: () => Guild
): (event: PuzzlehuntChangeEvent) => Promise<void> {
	return async (event) => {
		const guild = getGuild();
		await executeChangeWork(context, guild, calculateChangeWork(event));
	};
}

/** Resolve live model values for sync, retaining event snapshots for removals. */
export async function executeChangeWork(
	context: PuzzlehuntContext,
	guild: Guild,
	work: PuzzlehuntSyncWork,
	provisioning: SyncProvisioning = createSyncProvisioning(context, guild)
): Promise<void> {
	const resolveNode = (node: DocumentNode): Puzzle | Round =>
		node.type === 'puzzle'
			? context.puzzlehunt.getPuzzle(node.id)
			: context.puzzlehunt.getRound(node.id);
	// TODO: Need a task queue to ensure concurrent tasks don't cause issues. If there is overlap between create/delete
	// current code likely can into issues.
	const tasks: Promise<void>[] = [];
	for (const node of work.removedNodes) {
		// Note: we explicitly don't delete google sheets here, since it's riskier in case the delete
		// was an accident.
		tasks.push(removeDiscordAssociation(guild, node));
	}
	await Promise.all(tasks);
	tasks.length = 0;

	// Provision rounds in parallel before creating puzzle resources.
	await Promise.all(
		work.addedRounds
			.filter((node) => !node.discord)
			.map((node) => provisioning.discord(resolveNode(node)))
	);
	for (const node of work.addedPuzzles) {
		if (!node.discord) {
			tasks.push(provisioning.discord(resolveNode(node)));
		}
		if (!node.sheetId) {
			tasks.push(provisioning.googleSheet(node));
		}
	}

	await Promise.all([
		...tasks,
		...work.channelsToSync.map((node) =>
			node.discord
				? syncChannel(context, guild, resolveNode(node))
				: undefined
		),
		...work.rolesToSync.map((node) =>
			node.discord
				? syncRoles(context, guild, resolveNode(node))
				: undefined
		),
	]);
}

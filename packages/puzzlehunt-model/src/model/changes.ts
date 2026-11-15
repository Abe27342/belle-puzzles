import type { DocumentNode } from '../document.js';
import type { PuzzlehuntChangeEvent, PuzzlehuntView } from './types.js';

function nodes(view: PuzzlehuntView): Map<string, DocumentNode> {
	return new Map<string, DocumentNode>([
		...view.rounds.map(
			({ children, ...round }) => [round.id, round] as const
		),
		...view.puzzles.map((puzzle) => [puzzle.id, puzzle] as const),
	]);
}

/** Compare domain properties, not derived children or backend-specific edit records. */
export function diffPuzzlehuntViews(
	before: PuzzlehuntView,
	after: PuzzlehuntView
): PuzzlehuntChangeEvent {
	const oldNodes = nodes(before);
	const newNodes = nodes(after);
	const changes: PuzzlehuntChangeEvent['changes'][number][] = [];
	for (const [id, node] of oldNodes) {
		const next = newNodes.get(id);
		if (!next) {
			changes.push({ type: 'node-removed', node });
		} else if (!equalNode(node, next)) {
			changes.push({ type: 'node-changed', before: node, after: next });
		}
	}
	for (const [id, node] of newNodes) {
		if (!oldNodes.has(id)) {
			changes.push({ type: 'node-added', node });
		}
	}
	return { before, after, changes };
}

function equalNode(before: DocumentNode, after: DocumentNode): boolean {
	const { discord: oldDiscord, ...oldProperties } = before;
	const { discord: newDiscord, ...newProperties } = after;
	function equalProperties(a: object, b: object): boolean {
		const left = Object.entries(a);
		const right = Object.entries(b);
		return (
			left.length === right.length &&
			left.every(([key, value]) =>
				right.some(([k, v]) => k === key && v === value)
			)
		);
	}
	return (
		equalProperties(oldProperties, newProperties) &&
		(oldDiscord === newDiscord ||
			(oldDiscord !== undefined &&
				newDiscord !== undefined &&
				equalProperties(oldDiscord, newDiscord)))
	);
}

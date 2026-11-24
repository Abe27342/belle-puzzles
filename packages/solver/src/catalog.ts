import type { CartesianGridPuzzle } from './lib/cartesian-grid-puzzle.js';
import type { HashiRenderOptions } from './puzzles/hashi.js';
import type { PearlRenderOptions } from './puzzles/masyu.js';

export type PuzzleRenderOptions = Partial<
	HashiRenderOptions & PearlRenderOptions
>;

export interface PuzzleRegistration {
	name: string;
	instructions: string;
	example: string;
	parser: {
		fromText(
			text: string,
			renderOptions?: PuzzleRenderOptions
		): CartesianGridPuzzle<unknown>;
	};
}

const registrations: Record<string, PuzzleRegistration> = {};

export const puzzleTypes: Readonly<Record<string, PuzzleRegistration>> =
	registrations;

export function isPuzzleType(value: string): boolean {
	return Object.prototype.hasOwnProperty.call(registrations, value);
}

export function registerPuzzle(
	type: string,
	definition: PuzzleRegistration
): void {
	if (isPuzzleType(type)) {
		throw new Error(`Puzzle type "${type}" is already registered.`);
	}
	Object.defineProperty(registrations, type, {
		value: Object.freeze(definition),
		enumerable: true,
	});
}

import type { CartesianGridPuzzle } from './lib/cartesian-grid-puzzle.js';

export interface PuzzleRegistration {
	name: string;
	instructions: string;
	example: string;
	parser: {
		fromText(text: string): CartesianGridPuzzle<unknown>;
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

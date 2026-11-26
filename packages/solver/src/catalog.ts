import type { CartesianGridPuzzle } from './lib/cartesian-grid-puzzle.js';

export interface PuzzleRegistration {
	name: string;
	instructions: string;
	example: string;
	parser: {
		fromText(text: string): CartesianGridPuzzle<unknown>;
	};
}

export interface AliasedPuzzleRegistration extends PuzzleRegistration {
	aliases?: string[];
}

const registrations: Record<string, PuzzleRegistration> = {};

export const puzzleTypes: Readonly<Record<string, PuzzleRegistration>> =
	registrations;

export function isPuzzleType(value: string): boolean {
	return Object.prototype.hasOwnProperty.call(registrations, value);
}

function registerPuzzleType(definition: PuzzleRegistration): void {
	const type = definition.name;
	if (isPuzzleType(type)) {
		throw new Error(`Puzzle type "${type}" is already registered.`);
	}

	Object.defineProperty(registrations, type, {
		value: Object.freeze(definition),
		enumerable: true,
	});
}

export function registerPuzzle(definition: AliasedPuzzleRegistration): void {
	const { name, aliases, ...rest } = definition;
	registerPuzzleType({ name, ...rest });
	for (const alias of aliases ?? []) {
		registerPuzzleType({ name: alias, ...rest });
	}
}

import type { CartesianGridPuzzle } from './lib/cartesian-grid-puzzle.js';

export interface PuzzleRegistration {
	name: string;
	aliases?: string[];
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

export function registerPuzzle(definition: PuzzleRegistration): void {
	const type = definition.name;
	if (isPuzzleType(type)) {
		throw new Error(`Puzzle type "${type}" is already registered.`);
	}

	const register = (name: string) =>
		Object.defineProperty(registrations, name, {
			value: Object.freeze(definition),
			enumerable: true,
		});

	register(type);
	for (const alias of definition.aliases ?? []) {
		if (isPuzzleType(alias)) {
			throw new Error(`Puzzle alias "${alias}" is already registered.`);
		}
		register(alias);
	}
}

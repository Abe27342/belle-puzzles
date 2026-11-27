import { puzzleTypes } from '@belle-puzzles/solver';

export function kebabCasePuzzleRoute(value: string): string {
	let decoded = value;
	try {
		decoded = decodeURIComponent(value);
	} catch {
		// Keep malformed route parameters usable as ordinary text.
	}

	return decoded
		.normalize('NFKC')
		.trim()
		.replace(/([a-z0-9])([A-Z])/g, '$1-$2')
		.replace(/[^A-Za-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.toLowerCase();
}

export function puzzleRouteName(type: string): string {
	return puzzleTypes[type]
		? kebabCasePuzzleRoute(puzzleTypes[type].name)
		: kebabCasePuzzleRoute(type);
}

export function puzzleTypeFromRouteParam(param: string): string | undefined {
	const normalized = kebabCasePuzzleRoute(param);
	return Object.entries(puzzleTypes).find(
		([, definition]) => kebabCasePuzzleRoute(definition.name) === normalized
	)?.[0];
}

import { puzzleTypes, type PuzzleType } from './catalog';

export type SolverErrorStage =
	| 'runtime'
	| 'parse'
	| 'build'
	| 'solve'
	| 'render'
	| 'cleanup';

export function errorMessage(error: unknown, depth = 0): string {
	if (depth > 2) return '';
	if (typeof error === 'string') {
		const message = error.trim();
		return /^(?:Uncaught\s+)?\[object .+\]$/.test(message) ? '' : message;
	}
	if (typeof error === 'object' && error !== null) {
		if ('message' in error && typeof error.message === 'string') {
			const message = errorMessage(error.message, depth + 1);
			if (message) return message;
		}
		if ('error' in error && error.error !== error) {
			return errorMessage(error.error, depth + 1);
		}
	}
	return '';
}

export function formatSolverError(
	error: unknown,
	stage: SolverErrorStage,
	puzzleType?: PuzzleType
): string {
	const name = puzzleType ? puzzleTypes[puzzleType].name : 'logic';
	const guidance: Record<SolverErrorStage, string> = {
		runtime:
			'The solver could not start. Reload the page and try again. Check your connection if it still fails.',
		parse: `Could not parse this ${name} puzzle. Check the format instructions and the indicated row or clue, or load an example.`,
		build: `Could not build this ${name} puzzle. Check the clues and grid dimensions, then try again.`,
		solve: `The solver could not finish this ${name} puzzle. Check the clues and try Solve again. If the problem persists, reload the page.`,
		render: 'The solution could not be displayed. Try Solve again, or reload the page if the problem persists.',
		cleanup:
			'The solver could not shut down cleanly. Reload the page before starting another solve.',
	};
	const detail = errorMessage(error);
	const coordinate =
		stage === 'parse' ? /\bat (\d+),(\d+)\b/.exec(detail) : null;
	const location = coordinate
		? ` Row ${Number(coordinate[2]) + 1}, column ${
				Number(coordinate[1]) + 1
		  }.`
		: '';
	return detail
		? `${guidance[stage]}${location} Details: ${detail}`
		: guidance[stage];
}

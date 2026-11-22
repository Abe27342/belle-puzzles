import type { CartesianCoord } from './graph/index.js';

export type TextGridVisitor = (
	values: readonly string[],
	coord: CartesianCoord
) => void;

export interface TextGridParseOptions {
	/** Require this number of grids, for puzzle formats with a fixed layout. */
	gridCount?: number;
}

/** Whether a grid character is an empty placeholder. */
export function isEmptyGridCharacter(value: string): boolean {
	return value === '.' || /^\s$/.test(value);
}

/** Parse exactly one ASCII digit, throwing with its grid coordinate otherwise. */
export function parseDigit(value: string, coord: CartesianCoord): number {
	if (!/^[0-9]$/.test(value)) {
		throw new Error(`Invalid digit at ${coord}: ${JSON.stringify(value)}`);
	}
	return Number(value);
}

/** Parse a B/W pearl color, case-insensitively, or throw with its coordinate. */
export function parsePearlColor(
	value: string,
	coord: CartesianCoord
): 'black' | 'white' {
	switch (value) {
		case 'B':
		case 'b':
			return 'black';
		case 'W':
		case 'w':
			return 'white';
		default:
			throw new Error(
				`Invalid pearl color at ${coord}: ${JSON.stringify(value)}`
			);
	}
}

/**
 * Parse rectangular character grids separated by one or more blank lines.
 * Surrounding whitespace is ignored; LF and CRLF line endings are supported.
 * All grids must have the same dimensions. Each character is one value, so
 * multi-digit clues need a different format.
 *
 * The visitor runs in row-major order at each position where any grid contains a
 * non-empty character (anything other than "." or whitespace). The visitor
 * receives the values from all grids in input order, including empty values,
 * and a zero-based [x, y] coordinate with y increasing downwards.
 *
 * Returned width and height count character positions, using vertex (go-style)
 * dimensions, not edge spans or face counts. Vertex-clue puzzles can use them
 * directly. If characters represent faces, add 1 to both dimensions when
 * constructing a CartesianGridGraph; clue coordinates themselves stay unchanged.
 * All dimensions are validated before the visitor is called.
 */
export function parseTextGrids(
	text: string,
	visitor: TextGridVisitor,
	options: TextGridParseOptions = {}
): { width: number; height: number } {
	const normalized = text.replace(/\r\n?/g, '\n').trim();
	if (normalized.length === 0) {
		throw new Error('Expected at least one non-empty text grid');
	}
	const grids = normalized
		.split(/\n[ \t]*\n(?:[ \t]*\n)*/)
		.map((grid) => grid.split('\n'));
	if (options.gridCount !== undefined && grids.length !== options.gridCount) {
		throw new Error(
			`Expected ${options.gridCount} text grids, received ${grids.length}`
		);
	}
	const height = grids[0].length;
	const width = grids[0][0].length;
	for (const [index, lines] of grids.entries()) {
		if (lines.length !== height) {
			throw new Error(`Grid ${index + 1} must have ${height} rows`);
		}
		if (lines.some((line) => line.length !== width)) {
			throw new Error(
				`Grid ${index + 1} must have ${width} columns in every row`
			);
		}
	}

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const values = grids.map((grid) => grid[y][x]);
			if (values.some((value) => !isEmptyGridCharacter(value))) {
				visitor(values, [x, y]);
			}
		}
	}
	return { width, height };
}

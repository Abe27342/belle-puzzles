export const puzzleTypes = {
	sudoku: {
		name: 'Sudoku',
		instructions:
			'Enter nine rows of nine characters. Use digits 1-9 for givens.',
		example:
			'53..7....\n6..195...\n.98....6.\n8...6...3\n4..8.3..1\n7...2...6\n.6....28.\n...419..5\n....8..79',
	},
	masyu: {
		name: 'Masyu',
		instructions:
			'Enter B for black pearls and W for white pearls, one character per grid vertex.',
		example: 'B..\n...\n..B',
	},
	shingoki: {
		name: 'Shingoki',
		instructions:
			'Enter two equally sized grids separated by a blank line: B/W pearl colors, then single-digit lengths at the same positions.',
		example:
			'.W....\n..B...\n......\nB....W\nWB..B.\n......\n\n.3....\n..2...\n......\n6....5\n22..2.\n......',
	},
	slitherlink: {
		name: 'Slitherlink',
		instructions:
			'Enter a rectangular grid of single-digit cell clues (0-4).',
		example: '4',
	},
	cave: {
		name: 'Cave',
		instructions:
			'Enter a rectangular grid of single-digit cell clues (0-9). Multi-digit clues are not supported.',
		example: '1',
	},
	hashi: {
		name: 'Hashi',
		instructions:
			'Enter a rectangular grid of islands, using digits 1-8 for their bridge counts.',
		example: '2.2',
	},
};

export type PuzzleType = keyof typeof puzzleTypes;

export function isPuzzleType(value: string): value is PuzzleType {
	return Object.prototype.hasOwnProperty.call(puzzleTypes, value);
}

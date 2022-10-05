import type { IPuzzlehunt } from './fluid/puzzlehunt';

// TODO: Throw a version field in here.
export interface SerializedPuzzlehuntContext {
	fluidFileId: string;
	googleFolderId: string;
	indexId: string;
	name: string;
	allPuzzlesRoleId: string;
}

export interface PuzzlehuntContext extends SerializedPuzzlehuntContext {
	puzzlehunt: IPuzzlehunt;
}

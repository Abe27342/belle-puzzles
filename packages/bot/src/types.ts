import type { IPuzzlehunt } from '@belle-puzzles/puzzlehunt-model';
import type { Message } from 'discord.js';

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
	huntContextMessage: Message<true>;
}

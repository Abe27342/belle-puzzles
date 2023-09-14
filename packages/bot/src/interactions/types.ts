import { Interaction } from 'discord.js';
import { PuzzlehuntContext } from '../puzzlehunt-context';

export interface InteractionHandler {
	name: string;
	execute: (
		context: PuzzlehuntContext,
		interaction: Interaction
	) => Promise<void>;
}

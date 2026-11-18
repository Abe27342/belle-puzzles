import { Interaction } from 'discord.js';
import { PuzzlehuntContext } from '../puzzlehunt-context.js';

export interface InteractionHandler {
	name: string;
	execute: (
		context: PuzzlehuntContext,
		interaction: Interaction
	) => Promise<void>;
}

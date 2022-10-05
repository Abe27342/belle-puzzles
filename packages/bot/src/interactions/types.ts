import { Interaction } from 'discord.js';
import { PuzzlehuntContext } from '../types';

export interface InteractionHandler {
	name: string;
	execute: (
		context: PuzzlehuntContext,
		interaction: Interaction
	) => Promise<void>;
}

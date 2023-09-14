import type {
	SlashCommandBuilder,
	ChatInputCommandInteraction,
} from 'discord.js';
import type { PuzzlehuntContext } from '../puzzlehunt-context';

export interface Command {
	requiresSerializedContext?: boolean; // defaults to true
	data: SlashCommandBuilder;
	testServerOnly?: boolean; // defaults to false
	adminOnly?: boolean; // defaults to false
	execute: (
		context: PuzzlehuntContext,
		interaction: ChatInputCommandInteraction
	) => Promise<void>;
}

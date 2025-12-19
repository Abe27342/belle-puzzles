import type {
	SlashCommandBuilder,
	ChatInputCommandInteraction,
	SlashCommandOptionsOnlyBuilder,
} from 'discord.js';
import type { PuzzlehuntContext } from '../puzzlehunt-context';

export interface Command {
	requiresSerializedContext?: boolean; // defaults to true
	data: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder;
	testServerOnly?: boolean; // defaults to false
	adminOnly?: boolean; // defaults to false
	execute: (
		context: PuzzlehuntContext,
		interaction: ChatInputCommandInteraction
	) => Promise<void>;
}

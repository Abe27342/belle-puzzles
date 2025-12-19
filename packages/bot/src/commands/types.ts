import type {
	SlashCommandBuilder,
	ChatInputCommandInteraction,
	SlashCommandOptionsOnlyBuilder,
	SlashCommandSubcommandsOnlyBuilder,
} from 'discord.js';
import type { PuzzlehuntContext } from '../puzzlehunt-context';

export type SlashCommandData =
	| SlashCommandBuilder
	| SlashCommandOptionsOnlyBuilder
	| SlashCommandSubcommandsOnlyBuilder;

export interface Command {
	requiresSerializedContext?: boolean; // defaults to true
	data: SlashCommandBuilder | SlashCommandData;
	testServerOnly?: boolean; // defaults to false
	adminOnly?: boolean; // defaults to false
	execute: (
		context: PuzzlehuntContext,
		interaction: ChatInputCommandInteraction
	) => Promise<void>;
}

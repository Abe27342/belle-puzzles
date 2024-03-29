import { expect } from 'vitest';
import {
	ApplicationCommandOptionType,
	ChatInputCommandInteraction,
	SlashCommandBuilder,
	SlashCommandSubcommandsOnlyBuilder,
} from 'discord.js';
import { ChannelData, MockDiscord } from './mockDiscord.js';
import { BelleBotClient } from '../client';
import * as commandsModule from '../commands/index.js';
import { IPuzzlehuntProvider } from '../puzzlehunt-provider.js';
import {
	IPuzzlehunt,
	PuzzleObject,
	Round,
} from '@belle-puzzles/puzzlehunt-model';
import { SerializedPuzzlehuntContext } from '../puzzlehunt-context.js';

// TODO: There's a lot of `any` in this file.

export const defaultConfig = {
	id: '11',
	lang: 'en',
	prefix: '.',
	almanaxChannel: 'almanax',
	partyChannel: 'listagem-de-grupos',
	buildPreview: 'enabled',
};

const resolveChannel = (
	data: {
		name: string;
		type: ApplicationCommandOptionType;
		value: string;
	},
	mockDiscord: MockDiscord
) => {
	const match = data.value.match(/^<#(\d*)>$/);
	if (!match) {
		throw new Error(`Invalid channel format: ${data.value}`);
	}
	const [, indexChannelId] = match;
	return mockDiscord.serverState.findChannelBy('id', indexChannelId);
};

export const optionType: any = {
	// 0: null,
	// 1: subCommand,
	// 2: subCommandGroup,
	3: String,
	4: Number,
	5: Boolean,
	// 6: user,
	[ApplicationCommandOptionType.Channel]: String, // handled higher up
	// 8: role,
	// 9: mentionable,
	10: Number,
};

function getNestedOptions(options: any[]): any {
	return options.reduce((allOptions, optionable) => {
		const option = optionable.toJSON();
		if (!option.options) return [...allOptions, option];
		const nestedOptions = getNestedOptions(optionable.options);
		return [option, ...allOptions, ...nestedOptions];
	}, []);
}

function castToType(value: string, typeId: number) {
	const typeCaster = optionType[typeId];
	return typeCaster ? typeCaster(value) : value;
}

function getParsedCommand(
	stringCommand: string,
	commandData: SlashCommandBuilder | SlashCommandSubcommandsOnlyBuilder,
	mockDiscord: MockDiscord
) {
	const options = getNestedOptions(commandData.options);
	const optionsIndentifiers = options.map((option: any) => `${option.name}:`);
	const resolved: any = {
		users: {},
		members: {},
		roles: {},
		attachments: {},
		channels: {},
	};
	const requestedOptions = options.reduce(
		(requestedOptions: any, option: any) => {
			const identifier = `${option.name}:`;
			if (!stringCommand.includes(identifier)) return requestedOptions;
			const remainder = stringCommand.split(identifier)[1];

			const nextOptionIdentifier = remainder
				.split(' ')
				.find((word) => optionsIndentifiers.includes(word));
			let result: {
				name: string;
				value: any;
				type: ApplicationCommandOptionType;
				channel?: ChannelData;
			};
			if (nextOptionIdentifier) {
				const value = remainder.split(nextOptionIdentifier)[0].trim();
				result = {
					name: option.name,
					value: castToType(value, option.type),
					type: option.type,
				};
			} else {
				result = {
					name: option.name,
					value: castToType(remainder.trim(), option.type),
					type: option.type,
				};
			}

			if (result.type === ApplicationCommandOptionType.Channel) {
				resolved.channels[result.value] = resolveChannel(
					result,
					mockDiscord
				);
			}

			return [...requestedOptions, result];
		},
		[]
	);
	const optionNames = options.map((option: any) => option.name);
	const splittedCommand = stringCommand.split(' ');
	const name = splittedCommand[0].replace('/', '');
	const subcommand = splittedCommand.find((word) =>
		optionNames.includes(word)
	);
	return {
		id: name,
		name,
		type: 1,
		options: subcommand
			? [
					{
						name: subcommand,
						type: 1,
						options: requestedOptions,
					},
			  ]
			: requestedOptions,
		resolved,
	};
}

const commands = Object.values(commandsModule);

export async function runCommand(
	command: string,
	client: BelleBotClient,
	mockDiscord: MockDiscord,
	interactionSource?: ChannelData
): Promise<ChatInputCommandInteraction> {
	const [, commandName] = command.match(/\/([^ ]*).*/);
	const commandSchema = commands.find(
		(command) => command.data.name === commandName
	);
	expect(commandSchema).toBeDefined();
	const parsedCommand = getParsedCommand(
		command,
		commandSchema.data,
		mockDiscord
	);
	const interaction = mockDiscord.createCommandInteraction(
		parsedCommand,
		interactionSource
	);
	client.emit('interactionCreate', interaction);
	await client.ensurePendingWorkProcessed();
	return interaction;
}

export async function runCommands(
	client: BelleBotClient,
	mockDiscord: MockDiscord,
	commands: string[]
): Promise<ChatInputCommandInteraction[]> {
	const interactions: ChatInputCommandInteraction[] = [];
	for (const command of commands) {
		interactions.push(await runCommand(command, client, mockDiscord));
	}
	return interactions;
}

export function loadPuzzlehunt(
	puzzlehuntProvider: IPuzzlehuntProvider,
	mockDiscord: MockDiscord
): Promise<IPuzzlehunt> {
	const {
		serverState: { channels, messages },
	} = mockDiscord;
	const adminChannel = channels.find(
		(channel) => channel.name === 'belle-bot-admin'
	);
	const adminMessage = messages.get(adminChannel.id)[0];
	const puzzlehuntContext: SerializedPuzzlehuntContext = JSON.parse(
		adminMessage.content
	);
	expect(puzzlehuntContext.fluidFileId).toBeDefined();
	return puzzlehuntProvider.getPuzzlehunt(
		puzzlehuntContext.fluidFileId,
		() => {}
	);
}

export function expectParentChild(parent: Round, child: PuzzleObject) {
	expect(parent.children.map((child) => child.id)).toContain(child.id);
	expect(child.roundId).toEqual(parent.id);
}

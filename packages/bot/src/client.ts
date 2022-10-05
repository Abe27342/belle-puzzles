// Require the necessary discord.js classes
import { Client, Collection, GatewayIntentBits } from 'discord.js';
import * as commandsModule from './commands/index.js';
import * as interactionsModule from './interactions/index.js';
import type { Command } from './commands/types';
import type { InteractionHandler } from './interactions/types';

export interface BelleBotClient extends Client<boolean> {
	commands: Collection<string, Command>;
	interactions: Collection<string, InteractionHandler>;
}

function getCommandsCollection(): Collection<string, Command> {
	const commands = new Collection<string, Command>();
	for (const commandImport of Object.values(commandsModule)) {
		commands.set(commandImport.data.name, commandImport);
	}
	return commands;
}

function getInteractionsCollection(): Collection<string, InteractionHandler> {
	const interactions = new Collection<string, InteractionHandler>();
	for (const interactionImport of Object.values(interactionsModule)) {
		interactions.set(interactionImport.name, interactionImport);
	}
	return interactions;
}

export function createClient(): BelleBotClient {
	const client = new Client({
		intents: [GatewayIntentBits.Guilds],
	}) as BelleBotClient;
	client.commands = getCommandsCollection();
	client.interactions = getInteractionsCollection();
	return client;
}

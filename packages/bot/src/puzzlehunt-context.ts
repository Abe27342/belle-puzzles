import type {
	IPuzzlehunt,
	NumberNode,
	Puzzle,
	Round,
	StringNode,
} from '@belle-puzzles/puzzlehunt-model';
import type { Message } from 'discord.js';
import { Guild, Interaction } from 'discord.js';
import { assert, getHuntContextMessage } from './utils/index.js';
import { makeViewChangeHandler } from './sync/viewChangeHandler.js';
import type { BelleBotClient } from './client.js';
import { NodeId, TreeView } from '@fluid-experimental/tree';

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

// undefined indicates hunt context could not be found / erroneous state that was communicated
// to the user. Do not dispatch further commands.
export async function getHuntContext(
	client: BelleBotClient,
	guild: Guild,
	interaction?: Interaction
): Promise<PuzzlehuntContext | undefined> {
	const adminMessage = await getHuntContextMessage(guild, interaction);
	const context: SerializedPuzzlehuntContext = JSON.parse(
		adminMessage.content
	);
	assert(
		context.name !== undefined && context.fluidFileId !== undefined,
		"Admin message didn't provide the correct context."
	);
	const puzzlehunt = await client.puzzlehuntProvider.getPuzzlehunt(
		context.fluidFileId,
		(puzzlehunt: IPuzzlehunt) => {
			console.log(
				`Opening file ${context.fluidFileId} and listening for changes.`
			);
			const getGuild = () => client.guilds.cache.get(puzzlehunt.guildId);
			const viewChangeHandler = makeViewChangeHandler(
				{
					...context,
					puzzlehunt,
					huntContextMessage: adminMessage,
				},
				getGuild
			);
			puzzlehunt.on(
				'viewChange',
				(
					before: TreeView,
					after: TreeView,
					getHandle: (
						view: TreeView,
						id: NodeId
					) => StringNode | NumberNode | Puzzle | Round | undefined
				) => {
					client.pushAsyncWork(
						'viewChange',
						viewChangeHandler(before, after, getHandle)
					);
				}
			);
		}
	);
	return { ...context, puzzlehunt, huntContextMessage: adminMessage };
}

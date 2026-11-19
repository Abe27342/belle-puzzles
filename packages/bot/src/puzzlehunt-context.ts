import type { IPuzzlehunt } from '@belle-puzzles/puzzlehunt-model';
import type { PuzzlehuntModel } from '@belle-puzzles/puzzlehunt-model/model';
import {
	snowflake,
	HuntCommandError,
	type HuntSnapshot,
} from '@belle-puzzles/puzzlehunt-model/document';
import {
	parsePuzzlehuntPin,
	parsePuzzlehuntDescriptor,
	HuntHttpError,
	type PuzzlehuntDescriptor,
	type FluidHuntPin,
	type PostgresHuntDescriptor,
} from '@belle-puzzles/puzzlehunt-model/http';
import { queue } from 'async';
import type { Message } from 'discord.js';
import { Guild, Interaction } from 'discord.js';
import { getHuntContextMessage } from './utils/index.js';
import { makeViewChangeHandler } from './sync/viewChangeHandler.js';
import type { BelleBotClient } from './client.js';
import { settlePostgresModel } from './puzzlehunt-provider.js';

export type SerializedPuzzlehuntContext = FluidHuntPin;

export interface FluidPuzzlehuntContext extends SerializedPuzzlehuntContext {
	backend: 'fluid';
	puzzlehunt: IPuzzlehunt;
	huntContextMessage: Message<true>;
}

/**
 * Active PostgreSQL scope and refreshed HTTP model for bot commands.
 *
 * @remarks
 * Never attach the Fluid view-change handler to this optimistic model. The durable
 * worker owns external provisioning and event logs through shared reconciliation.
 * Mutating replies await authoritative settlement, not external resource readiness.
 * PostgreSQL solve clears status and records its durable log; direct solve/status
 * logs and redundant clear-status mutations remain exclusive to the Fluid path.
 */
export interface PostgresPuzzlehuntContext extends PostgresHuntDescriptor {
	puzzlehunt: PuzzlehuntModel;
	huntContextMessage: Message<true>;
	googleFolderId: string;
	indexId: string;
	allPuzzlesRoleId: string;
}

export type PuzzlehuntContext =
	| FluidPuzzlehuntContext
	| PostgresPuzzlehuntContext;

export class HuntContextError extends Error {
	constructor(
		public readonly status: number,
		message: string,
		options?: ErrorOptions
	) {
		super(message, options);
	}
}

export async function settleHuntContext(
	context: PuzzlehuntContext
): Promise<void> {
	if (context.backend === 'postgres')
		await settlePostgresModel(context.puzzlehunt);
}

/** Resolves public metadata without loading a model or subscribing to Fluid changes. */
export async function resolveHuntDescriptor(
	client: BelleBotClient,
	guild: Guild,
	interaction?: Interaction
): Promise<
	{ descriptor: PuzzlehuntDescriptor; message: Message<true> } | undefined
> {
	const message = await getHuntContextMessage(guild, interaction);
	if (!message) {
		if (
			guild.channels.cache.some(
				(channel) => channel.name === 'belle-bot-admin'
			)
		) {
			throw new HuntContextError(
				409,
				'Incomplete or ambiguous hunt setup: no unique backend pin. Inspect the admin channel; do not rerun /create.'
			);
		}
		return undefined;
	}
	let pin: ReturnType<typeof parsePuzzlehuntPin>;
	try {
		pin = parsePuzzlehuntPin(JSON.parse(message.content));
	} catch (error) {
		throw new HuntContextError(
			409,
			'Invalid or incomplete backend pin; inspect the admin channel. Do not rerun /create.',
			{ cause: error }
		);
	}
	if (!('backend' in pin)) {
		return { descriptor: { backend: 'fluid', ...pin }, message };
	}
	if (pin.guildId !== guild.id) {
		throw new HuntContextError(
			409,
			'PostgreSQL backend pin belongs to another guild.'
		);
	}
	if (
		!client.localPostgres?.guildIds.includes(guild.id) ||
		!client.isGuildAllowed(guild.id)
	) {
		throw new HuntContextError(
			403,
			'PostgreSQL is disabled for this guild; the existing hunt will not be replaced or loaded as Fluid.'
		);
	}
	let snapshot: HuntSnapshot;
	try {
		snapshot = await client.localPostgres.documents.readActive(guild.id);
	} catch (error) {
		if (
			(error instanceof HuntCommandError && error.code === 'not-found') ||
			(error instanceof HuntHttpError && error.status === 404)
		) {
			throw new HuntContextError(
				404,
				'No active PostgreSQL hunt exists for this guild.'
			);
		}
		throw new HuntContextError(
			503,
			'The local puzzlehunt service could not resolve the active hunt.',
			{ cause: error }
		);
	}
	try {
		const descriptor = parsePuzzlehuntDescriptor({
			backend: 'postgres',
			guildId: snapshot.guildId,
			huntId: snapshot.huntId,
			name: snapshot.document.name,
			configuration: snapshot.document.configuration,
		});
		return { descriptor, message };
	} catch (error) {
		throw new HuntContextError(
			409,
			'PostgreSQL hunt setup is incomplete. Inspect the database and Discord resources; do not rerun /create.',
			{ cause: error }
		);
	}
}

// undefined indicates hunt context could not be found / erroneous state that was communicated
// to the user. Do not dispatch further commands.
export async function getHuntContext(
	client: BelleBotClient,
	guild: Guild,
	interaction?: Interaction
): Promise<PuzzlehuntContext | undefined> {
	const resolved = await resolveHuntDescriptor(client, guild, interaction);
	if (!resolved) return undefined;
	const { descriptor: context, message: adminMessage } = resolved;
	if (context.backend === 'postgres') {
		if (!client.puzzlehuntProvider.getPostgresPuzzlehunt) {
			throw new HuntContextError(
				503,
				'The PostgreSQL model provider is unavailable.'
			);
		}
		const puzzlehunt =
			await client.puzzlehuntProvider.getPostgresPuzzlehunt({
				guildId: snowflake(context.guildId),
				huntId: context.huntId,
			});
		// Refresh goes through the model's existing command queue; the worker, not this
		// optimistic model, owns external effects.
		const snapshot = puzzlehunt.committedSnapshot;
		const current = parsePuzzlehuntDescriptor({
			...context,
			name: snapshot.document.name,
			configuration: snapshot.document.configuration,
		});
		if (current.backend !== 'postgres')
			throw new Error('Expected PostgreSQL descriptor.');
		return {
			...current,
			...current.configuration,
			puzzlehunt,
			huntContextMessage: adminMessage,
		};
	}
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

			// TODO: Verify error surfacing works here--I believe it does, but didn't explicitly test
			// after using this task queue.
			const viewUpdateQ = queue<() => Promise<unknown>, Error>(
				async (task, callback) => {
					try {
						await task();
						callback?.();
					} catch (error) {
						callback?.(error);
					}
				},
				1
			);

			puzzlehunt.subscribeChanges((event) => {
				// In addition to the bot sync tracking mechanism, we also execute any concurrent view
				// updates we receive in serial. This assumption could be removed if sync logic was a bit more robust,
				// but the perf considerations from doing this are pretty negligible--website puzzle adds
				// will already come in as a single change event due to call of `addPuzzles` and `addRounds`,
				// so this just means we don't parallelize puzzle adds from different clients interacting
				// with the bot/website.
				viewUpdateQ.push(() => {
					const workload = viewChangeHandler(event);
					client.pushAsyncWork('viewChange', workload);
					return workload;
				});

				client.pushAsyncWork('viewChange', viewUpdateQ.drain());
			});
		}
	);
	return { ...context, puzzlehunt, huntContextMessage: adminMessage };
}

import { randomUUID } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PuzzlehuntSnapshot } from '@belle-puzzles/puzzlehunt-model';
import {
	discoverHunt,
	listGuilds,
	verifyBot,
	verifyHuntContext,
	type AdminMessageSource,
	type DiscordReader,
	type ExportGuild,
	type HuntMetadata,
} from './discord.js';

export interface LoadedSnapshot {
	capturedAt: string;
	state: PuzzlehuntSnapshot;
}

export interface ExportDependencies {
	discord: DiscordReader;
	botId: string;
	fluidSource: { endpoint: string; tenantId?: string };
	loadSnapshot: (documentId: string) => Promise<LoadedSnapshot>;
}

type FailureStage =
	| 'authentication'
	| 'list-guilds'
	| 'discover-hunt'
	| 'load-document'
	| 'verify-context'
	| 'write-snapshot'
	| 'write-manifest';

interface ExportFailure {
	stage: FailureStage;
	message: string;
	stack?: string;
}

export interface GuildOutcome {
	guild: ExportGuild;
	status: 'exported' | 'no-hunt' | 'failed';
	metadata?: HuntMetadata;
	adminMessage?: AdminMessageSource;
	file?: string;
	failure?: ExportFailure;
}

export interface ExportManifest {
	format: 'belle-puzzlehunt-export';
	schemaVersion: 1;
	exportId: string;
	startedAt: string;
	finishedAt?: string;
	status: 'running' | 'finished';
	complete: boolean;
	guildDiscoveryComplete: boolean;
	source: {
		discordBotId: string;
		fluid: ExportDependencies['fluidSource'];
	};
	counts: {
		discovered: number;
		exported: number;
		noHunt: number;
		failed: number;
	};
	guilds: GuildOutcome[];
	failures: ExportFailure[];
}

function failure(error: unknown, stage: FailureStage): ExportFailure {
	return {
		stage,
		message: error instanceof Error ? error.message : String(error),
		stack: error instanceof Error ? error.stack : undefined,
	};
}

function json(value: unknown): string {
	return `${JSON.stringify(value, undefined, 2)}\n`;
}

async function writeManifest(
	outputDirectory: string,
	manifest: ExportManifest
): Promise<void> {
	const temporaryFile = join(outputDirectory, 'manifest.json.tmp');
	await writeFile(temporaryFile, json(manifest), { flag: 'wx', mode: 0o600 });
	await rename(temporaryFile, join(outputDirectory, 'manifest.json'));
}

export async function exportPuzzlehunts(
	outputDirectory: string,
	dependencies: ExportDependencies
): Promise<ExportManifest> {
	// Never overwrite an earlier export. An interrupted run retains complete:false.
	await mkdir(outputDirectory, { mode: 0o700 });
	const manifest: ExportManifest = {
		format: 'belle-puzzlehunt-export',
		schemaVersion: 1,
		exportId: randomUUID(),
		startedAt: new Date().toISOString(),
		status: 'running',
		complete: false,
		guildDiscoveryComplete: false,
		source: {
			discordBotId: dependencies.botId,
			fluid: dependencies.fluidSource,
		},
		counts: { discovered: 0, exported: 0, noHunt: 0, failed: 0 },
		guilds: [],
		failures: [],
	};
	await writeManifest(outputDirectory, manifest);
	let stage: FailureStage = 'authentication';
	try {
		await verifyBot(dependencies.discord, dependencies.botId);
		stage = 'list-guilds';
		for await (const guild of listGuilds(dependencies.discord)) {
			const outcome = await exportGuild(
				guild,
				outputDirectory,
				manifest.exportId,
				dependencies
			);
			manifest.guilds.push(outcome);
			manifest.counts.discovered++;
			if (outcome.status === 'exported') {
				manifest.counts.exported++;
			} else if (outcome.status === 'no-hunt') {
				manifest.counts.noHunt++;
			} else {
				manifest.counts.failed++;
			}
			stage = 'write-manifest';
			await writeManifest(outputDirectory, manifest);
			stage = 'list-guilds';
		}
		manifest.guildDiscoveryComplete = true;
	} catch (error) {
		manifest.failures.push(failure(error, stage));
	}
	manifest.finishedAt = new Date().toISOString();
	manifest.status = 'finished';
	manifest.complete =
		manifest.guildDiscoveryComplete &&
		manifest.counts.failed === 0 &&
		manifest.failures.length === 0;
	await writeManifest(outputDirectory, manifest);
	return manifest;
}

async function exportGuild(
	guild: ExportGuild,
	outputDirectory: string,
	exportId: string,
	dependencies: ExportDependencies
): Promise<GuildOutcome> {
	const outcome: GuildOutcome = { guild, status: 'failed' };
	let stage: FailureStage = 'discover-hunt';
	try {
		const discovery = await discoverHunt(
			dependencies.discord,
			guild.id,
			dependencies.botId
		);
		if (discovery.status === 'no-hunt') {
			return { guild, status: 'no-hunt' };
		}
		outcome.metadata = discovery.metadata;
		outcome.adminMessage = discovery.adminMessage;
		stage = 'load-document';
		const snapshot = await dependencies.loadSnapshot(
			discovery.metadata.fluidFileId
		);
		if (snapshot.state.guildId !== guild.id) {
			throw new Error(
				`Document guildId ${snapshot.state.guildId} does not match Discord guild ${guild.id}.`
			);
		}
		stage = 'verify-context';
		await verifyHuntContext(dependencies.discord, discovery.adminMessage);
		stage = 'write-snapshot';
		const file = `${guild.id}.json`;
		await writeFile(
			join(outputDirectory, file),
			json({
				format: 'belle-puzzlehunt-export',
				schemaVersion: 1,
				exportId,
				capturedAt: snapshot.capturedAt,
				source: {
					guild,
					fluid: {
						...dependencies.fluidSource,
						documentId: discovery.metadata.fluidFileId,
						model: '@fluid-experimental/tree',
						writeFormat: '0.1.1',
					},
					adminMessage: discovery.adminMessage,
				},
				metadata: discovery.metadata,
				state: snapshot.state,
			}),
			{ flag: 'wx', mode: 0o600 }
		);
		outcome.status = 'exported';
		outcome.file = file;
	} catch (error) {
		outcome.failure = failure(error, stage);
	}
	return outcome;
}

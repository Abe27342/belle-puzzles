import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { Client } from 'pg';
import { afterAll, beforeAll, expect } from 'vitest';
import {
	HuntCommandError,
	snowflake,
} from '@belle-puzzles/puzzlehunt-model/document';
import { HttpHuntDocumentClient } from '@belle-puzzles/puzzlehunt-model/http';
import { PuzzlehuntModel } from '@belle-puzzles/puzzlehunt-model/model';
import {
	comparableView,
	puzzlehuntModelContract,
} from '@belle-puzzles/puzzlehunt-model/testing/model-contract';
import { startLocalPostgres } from '@belle-puzzles/puzzlehunt-model/testing/postgres';
import { createPuzzlehuntApp } from '../app.js';
import { PostgresHuntChangeFeed } from '../changes.js';

const guildId = snowflake('contract-guild');
const token = 'contract-token';
let database: Awaited<ReturnType<typeof startLocalPostgres>>;
let changes: PostgresHuntChangeFeed | undefined;
let server: Server | undefined;
let baseUrl: string;

beforeAll(async () => {
	database = await startLocalPostgres();
	changes = new PostgresHuntChangeFeed(
		() => new Client(database.pool.options)
	);
	changes.start();
	const app = createPuzzlehuntApp({
		store: database.store,
		changes,
		async authorize(authorization, requestedGuildId) {
			if (authorization !== `Bearer ${token}`) {
				throw new HuntCommandError(
					'unauthorized',
					'Expected the contract test credential.'
				);
			}
			if (requestedGuildId !== guildId) {
				throw new HuntCommandError(
					'forbidden',
					'The contract credential cannot access this guild.'
				);
			}
		},
	});
	const httpServer = createServer(app);
	server = httpServer;
	await new Promise<void>((resolve, reject) => {
		httpServer.once('error', reject);
		httpServer.listen(0, '127.0.0.1', () => {
			httpServer.off('error', reject);
			resolve();
		});
	});
	const address = httpServer.address();
	if (!address || typeof address === 'string') {
		throw new Error('Expected a loopback HTTP port.');
	}
	baseUrl = `http://127.0.0.1:${address.port}`;
}, 60000);

afterAll(async () => {
	try {
		await changes?.close();
	} finally {
		try {
			const httpServer = server;
			if (httpServer?.listening) {
				await new Promise<void>((resolve, reject) =>
					httpServer.close((error) =>
						error ? reject(error) : resolve()
					)
				);
			}
		} finally {
			await database?.close();
		}
	}
}, 30000);

puzzlehuntModelContract(
	'HTTP model against a loopback service and disposable PostgreSQL',
	async () => {
		const scope = { huntId: crypto.randomUUID(), guildId };
		await database.reset(scope);
		function loadModel(huntScope: typeof scope) {
			return PuzzlehuntModel.load(
				new HttpHuntDocumentClient({
					baseUrl,
					getToken: () => token,
				}),
				huntScope
			);
		}
		const model = await loadModel(scope);
		const hunts = new Map([
			['Contract test hunt', { scope, models: [model] }],
		]);
		return {
			model,
			async createModel(huntName = 'Contract test hunt') {
				const hunt = hunts.get(huntName);
				if (hunt === undefined) {
					throw new Error(`Unknown hunt: ${huntName}`);
				}
				const connected = await loadModel(hunt.scope);
				hunt.models.push(connected);
				return connected;
			},
			async createHunt(huntName) {
				if (hunts.has(huntName)) {
					throw new Error(`Hunt already exists: ${huntName}`);
				}
				const independentScope = {
					...scope,
					huntId: crypto.randomUUID(),
				};
				await database.pool.query(
					`INSERT INTO hunts (id, guild_id, name, schema_version)
					 VALUES ($1, $2, $3, 1)`,
					[
						independentScope.huntId,
						independentScope.guildId,
						huntName,
					]
				);
				const independent = await loadModel(independentScope);
				hunts.set(huntName, {
					scope: independentScope,
					models: [independent],
				});
				return independent;
			},
			async synchronize(huntName = 'Contract test hunt') {
				const hunt = hunts.get(huntName);
				if (hunt === undefined) {
					throw new Error(`Unknown hunt: ${huntName}`);
				}
				await Promise.all(hunt.models.map((model) => model.flush()));
				await Promise.all(hunt.models.map((model) => model.refresh()));
				for (const other of hunt.models) {
					expect(comparableView(other.view)).toEqual(
						comparableView(hunt.models[0].view)
					);
				}
			},
			async close() {
				const results = await Promise.allSettled(
					[...hunts.values()].flatMap(({ models }) =>
						models.map((model) => model.flush())
					)
				);
				hunts.clear();
				const errors = results.flatMap((result) =>
					result.status === 'rejected' ? [result.reason] : []
				);
				if (errors.length > 0) {
					throw new AggregateError(
						errors,
						'HTTP models failed to flush.'
					);
				}
			},
		};
	}
);

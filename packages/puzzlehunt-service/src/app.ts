import express from 'express';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import cors from 'cors';
import {
	HuntCommandError,
	type HuntScope,
	isUuid,
	snowflake,
} from '@belle-puzzles/puzzlehunt-model/document';
import {
	decodeHuntCommandRequest,
	decodeHuntRevision,
	huntRejectionStatuses,
} from '@belle-puzzles/puzzlehunt-model/http';
import type { PostgresPuzzlehuntStore } from '@belle-puzzles/puzzlehunt-model/postgres';
import { HuntChangesUnavailableError } from './changes.js';
import type { HuntChangeFeed } from './changes.js';
export {
	HuntChangesUnavailableError,
	PostgresHuntChangeFeed,
} from './changes.js';
export type { HuntChangeFeed, HuntListenerConnection } from './changes.js';

export type HuntAuthorizer = (
	authorization: string | undefined,
	guildId: string
) => Promise<void>;

export interface PuzzlehuntAppOptions {
	readonly store: Pick<
		PostgresPuzzlehuntStore,
		'read' | 'readActive' | 'submit' | 'readUpdates' | 'readRevision'
	>;
	readonly changes: HuntChangeFeed;
	readonly authorize: HuntAuthorizer;
	readonly allowedOrigins?: readonly string[];
	readonly onError?: (error: unknown) => void;
}

function route(handler: RequestHandler): RequestHandler {
	return (req, res, next) => {
		Promise.resolve()
			.then(() => handler(req, res, next))
			.catch(next);
	};
}

/** Construction has no network or environment side effects; the host owns dependencies and listen/close. */
export function createPuzzlehuntApp(
	options: PuzzlehuntAppOptions
): express.Express {
	const app = express();
	const origins = options.allowedOrigins ?? [];
	app.disable('x-powered-by');
	app.disable('etag');
	app.use((req, res, next) => {
		res.set('Cache-Control', 'no-store');
		res.set('X-Content-Type-Options', 'nosniff');
		if (
			req.headers.origin !== undefined &&
			!origins.includes(req.headers.origin)
		) {
			next(
				new HuntCommandError(
					'forbidden',
					'This browser origin is not allowed.'
				)
			);
			return;
		}
		next();
	});
	app.use(
		cors({
			origin: [...origins],
			methods: ['GET', 'POST'],
			allowedHeaders: ['Authorization', 'Content-Type'],
			exposedHeaders: ['Retry-After'],
			maxAge: 600,
		})
	);
	app.get('/liveness', (_req, res) => {
		res.sendStatus(200);
	});
	app.param('guildId', (req, _res, next, guildId: string) => {
		Promise.resolve()
			.then(() => options.authorize(req.headers.authorization, guildId))
			.then(() => next(), next);
	});
	app.param('huntId', (_req, _res, next, huntId: string) => {
		if (!isUuid(huntId)) {
			next(
				new HuntCommandError(
					'invalid-command',
					'Expected a lowercase hunt UUID.'
				)
			);
			return;
		}
		next();
	});
	app.route('/guilds/:guildId/hunts/active')
		.get(
			route(async (req, res) => {
				res.json(await options.store.readActive(req.params.guildId));
			})
		)
		.all((_req, res) => {
			res.set('Allow', 'GET, HEAD')
				.status(405)
				.json({
					error: {
						code: 'invalid-command',
						message: 'Use GET to read the active hunt.',
					},
				});
		});
	app.route('/guilds/:guildId/hunts/:huntId')
		.get(
			route(async (req, res) => {
				const scope: HuntScope = {
					guildId: snowflake(req.params.guildId),
					huntId: req.params.huntId,
				};
				res.json(
					req.query.since === undefined
						? await options.store.read(scope)
						: await options.store.readUpdates(
								scope,
								decodeHuntRevision(req.query.since)
						  )
				);
			})
		)
		.all((_req, res) => {
			res.set('Allow', 'GET, HEAD')
				.status(405)
				.json({
					error: {
						code: 'invalid-command',
						message: 'Use GET to read a hunt.',
					},
				});
		});
	app.route('/guilds/:guildId/hunts/:huntId/changes')
		.get(
			route(async (req, res) => {
				if (res.destroyed) return;
				const scope: HuntScope = {
					guildId: snowflake(req.params.guildId),
					huntId: req.params.huntId,
				};
				let highest = -1;
				let disconnected = false;
				let cleaned = false;
				let heartbeat: ReturnType<typeof setInterval> | undefined;
				let rotation: ReturnType<typeof setTimeout> | undefined;
				let unsubscribe: (() => void) | undefined;
				const cleanup = () => {
					if (cleaned) return;
					cleaned = true;
					clearInterval(heartbeat);
					clearTimeout(rotation);
					unsubscribe?.();
				};
				const write = (revision: number) => {
					if (cleaned || revision <= highest) return;
					highest = revision;
					if (
						!res.write(
							`event: revision\ndata: ${JSON.stringify({
								huntId: scope.huntId,
								revision,
							})}\n\n`
						)
					) {
						cleanup();
						res.end();
					}
				};
				res.once('close', cleanup);
				// Register before the baseline read; hints received during that read are coalesced.
				unsubscribe = options.changes.subscribe(
					scope.huntId,
					(revision) => {
						if (res.headersSent) write(revision);
						else highest = Math.max(highest, revision);
					},
					() => {
						disconnected = true;
						cleanup();
						if (res.headersSent) res.end();
					}
				);
				if (cleaned) unsubscribe();
				try {
					const baseline = await options.store.readRevision(scope);
					if (disconnected) throw new HuntChangesUnavailableError();
					if (cleaned) return;
					const initial = Math.max(baseline, highest);
					highest = -1;
					res.status(200).set({
						'Content-Type': 'text/event-stream; charset=utf-8',
						'Cache-Control': 'no-store, no-transform',
						'X-Accel-Buffering': 'no',
					});
					if (req.method === 'HEAD') {
						cleanup();
						res.end();
						return;
					}
					res.flushHeaders();
					write(initial);
					if (cleaned) return;
					heartbeat = setInterval(() => {
						if (!res.write(': keepalive\n\n')) {
							cleanup();
							res.end();
						}
					}, 15000);
					heartbeat.unref();
					rotation = setTimeout(() => {
						cleanup();
						res.end();
					}, 180000);
					rotation.unref();
				} catch (error) {
					cleanup();
					throw error;
				}
			})
		)
		.all((_req, res) => {
			res.set('Allow', 'GET, HEAD')
				.status(405)
				.json({
					error: {
						code: 'invalid-command',
						message: 'Use GET to observe a hunt.',
					},
				});
		});
	app.route('/guilds/:guildId/hunts/:huntId/commands')
		.post(
			(req, res, next) => {
				if (!req.is('application/json')) {
					res.status(415).json({
						error: {
							code: 'invalid-command',
							message: 'Commands require application/json.',
						},
					});
					return;
				}
				next();
			},
			express.json({ limit: 1024 * 1024, strict: true, inflate: false }),
			route(async (req, res) => {
				const since =
					req.query.since === undefined
						? undefined
						: decodeHuntRevision(req.query.since);
				const request = decodeHuntCommandRequest(req.body);
				const scope: HuntScope = {
					guildId: snowflake(req.params.guildId),
					huntId: req.params.huntId,
				};
				const result = await options.store.submit(scope, request);
				if (since === undefined) {
					res.json(result);
					return;
				}
				try {
					// A later consistent read may include newer writes; the original receipt stays intact.
					const update = await options.store.readUpdates(
						scope,
						since
					);
					res.json({
						receipt: result.receipt,
						replayed: result.replayed,
						update,
					});
				} catch (error) {
					// Even a not-found read is not a rejection of the already committed command.
					throw new Error(
						'Hunt command committed but its synchronization response failed.',
						{ cause: error }
					);
				}
			})
		)
		.all((_req, res) => {
			res.set('Allow', 'POST')
				.status(405)
				.json({
					error: {
						code: 'invalid-command',
						message: 'Use POST to submit a command.',
					},
				});
		});
	app.use((_req, res) => {
		res.status(404).json({
			error: { code: 'not-found', message: 'API route not found.' },
		});
	});
	const handleError: ErrorRequestHandler = (
		error: unknown,
		_req,
		res,
		next
	) => {
		if (res.headersSent) {
			(options.onError ?? console.error)(error);
			res.end();
			return;
		}
		if (error instanceof HuntChangesUnavailableError) {
			res.set('Retry-After', '1')
				.status(503)
				.json({
					error: { code: 'unavailable', message: error.message },
				});
			return;
		}
		if (error instanceof HuntCommandError) {
			const status = huntRejectionStatuses[error.code][0];
			if (status === 401) {
				res.set('WWW-Authenticate', 'Bearer, Service');
			}
			res.status(status).json({
				error: { code: error.code, message: error.message },
			});
			return;
		}
		if (error instanceof Error && 'type' in error) {
			const status =
				error.type === 'entity.too.large'
					? 413
					: error.type === 'encoding.unsupported' ||
					  error.type === 'charset.unsupported'
					? 415
					: error.type === 'entity.parse.failed'
					? 400
					: undefined;
			if (status !== undefined) {
				res.status(status).json({
					error: {
						code: 'invalid-command',
						message:
							'Invalid, unsupported, or oversized JSON body.',
					},
				});
				return;
			}
		}
		(options.onError ?? console.error)(error);
		res.status(500).json({
			error: {
				code: 'internal-error',
				message: 'The puzzlehunt request could not be completed.',
			},
		});
	};
	app.use(handleError);
	return app;
}

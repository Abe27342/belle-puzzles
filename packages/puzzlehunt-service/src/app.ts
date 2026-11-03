import express from 'express';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import cors from 'cors';
import {
	HuntCommandError,
	isDocumentId,
} from '@belle-puzzles/puzzlehunt-model/document';
import {
	decodeHuntCommandRequest,
	huntRejectionStatuses,
} from '@belle-puzzles/puzzlehunt-model/http';
import type { PostgresPuzzlehuntStore } from '@belle-puzzles/puzzlehunt-model/postgres';

export type HuntAuthorizer = (
	authorization: string | undefined,
	guildId: string
) => Promise<void>;

export interface PuzzlehuntAppOptions {
	readonly store: Pick<
		PostgresPuzzlehuntStore,
		'read' | 'readActive' | 'submit'
	>;
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
		if (!isDocumentId(huntId)) {
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
				res.json(
					await options.store.read({
						guildId: req.params.guildId,
						huntId: req.params.huntId,
					})
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
				const request = decodeHuntCommandRequest(req.body);
				res.json(
					await options.store.submit(
						{
							guildId: req.params.guildId,
							huntId: req.params.huntId,
						},
						request
					)
				);
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
			next(error);
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

import express from 'express';
import cors from 'cors';
import { HuntCommandError } from '@belle-puzzles/puzzlehunt-model/document';
import type { PostgresPuzzlehuntStore } from '@belle-puzzles/puzzlehunt-model/postgres';
import type { HuntChangeFeed } from './changes.js';
import { createErrorHandler } from './middleware.js';
import { createHuntRouter } from './routes/hunts.js';
export {
	HuntChangesUnavailableError,
	PostgresHuntChangeFeed,
} from './changes.js';
export type { HuntChangeFeed, HuntListenerConnection } from './changes.js';
export { createDiscordHuntAuthorizer } from './auth.js';

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

/** Construction has no network or environment side effects; the host owns dependencies and listen/close. */
export function createPuzzlehuntApp(
	options: PuzzlehuntAppOptions
): express.Express {
	const app = express();
	const origins = options.allowedOrigins ?? [];
	app.disable('x-powered-by');
	app.disable('etag');
	app.use(function enforceRequestPolicy(req, res, next) {
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
	app.get('/liveness', function liveness(_req, res) {
		res.sendStatus(200);
	});
	app.use(createHuntRouter(options));
	app.use(function notFound(_req, res) {
		res.status(404).json({
			error: { code: 'not-found', message: 'API route not found.' },
		});
	});
	app.use(createErrorHandler(options.onError));
	return app;
}

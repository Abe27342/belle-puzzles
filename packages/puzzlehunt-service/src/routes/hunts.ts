import { Router, json } from 'express';
import type { RequestHandler } from 'express';
import {
	HuntCommandError,
	isUuid,
	snowflake,
} from '@belle-puzzles/puzzlehunt-model/document';
import type { HuntScope } from '@belle-puzzles/puzzlehunt-model/document';
import { decodeHuntRevision } from '@belle-puzzles/puzzlehunt-model/http';
import type { PuzzlehuntAppOptions } from '../app.js';
import { asyncHandler, methodNotAllowed } from '../middleware.js';
import { createObserveChangesHandler } from './changes.js';
import {
	createSubmitCommandHandler,
	requireJsonCommandBody,
} from './commands.js';

export function createHuntRouter(options: PuzzlehuntAppOptions): Router {
	const router = Router();
	router.param(
		'guildId',
		function authorizeGuild(req, _res, next, guildId: string) {
			Promise.resolve()
				.then(() =>
					options.authorize(req.headers.authorization, guildId)
				)
				.then(() => next(), next);
		}
	);
	router.param(
		'huntId',
		function validateHuntId(_req, _res, next, huntId: string) {
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
		}
	);

	const readActiveHunt: RequestHandler = async function readActiveHunt(
		req,
		res
	) {
		res.json(await options.store.readActive(req.params.guildId));
	};
	const readHunt: RequestHandler = async function readHunt(req, res) {
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
	};

	router
		.route('/guilds/:guildId/hunts/active')
		.get(asyncHandler(readActiveHunt))
		.all(methodNotAllowed('GET, HEAD', 'Use GET to read the active hunt.'));
	router
		.route('/guilds/:guildId/hunts/:huntId')
		.get(asyncHandler(readHunt))
		.all(methodNotAllowed('GET, HEAD', 'Use GET to read a hunt.'));
	router
		.route('/guilds/:guildId/hunts/:huntId/changes')
		.get(asyncHandler(createObserveChangesHandler(options)))
		.all(methodNotAllowed('GET, HEAD', 'Use GET to observe a hunt.'));
	router
		.route('/guilds/:guildId/hunts/:huntId/commands')
		.post(
			requireJsonCommandBody,
			json({ limit: 1024 * 1024, strict: true, inflate: false }),
			asyncHandler(createSubmitCommandHandler(options.store))
		)
		.all(methodNotAllowed('POST', 'Use POST to submit a command.'));
	return router;
}

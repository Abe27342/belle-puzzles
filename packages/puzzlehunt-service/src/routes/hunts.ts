import { Router, json } from 'express';
import type { RequestHandler } from 'express';
import {
	HuntCommandError,
	isUuid,
	snowflake,
} from '@belle-puzzles/puzzlehunt-model/document';
import type { HuntScope } from '@belle-puzzles/puzzlehunt-model/document';
import {
	decodeHuntCreateRequest,
	decodeHuntRevision,
	decodeHuntSelectionRequest,
} from '@belle-puzzles/puzzlehunt-model/http';
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
	const listHunts: RequestHandler = async function listHunts(req, res) {
		res.json(await options.store.list(req.params.guildId));
	};
	const createHunt: RequestHandler = async function createHunt(req, res) {
		const request = decodeHuntCreateRequest(req.body);
		res.status(201).json(
			await options.store.create(req.params.guildId, request)
		);
	};
	const selectActiveHunt: RequestHandler = async function selectActiveHunt(
		req,
		res
	) {
		const { huntId } = decodeHuntSelectionRequest(req.body);
		res.json(
			await options.store.selectActive({
				guildId: snowflake(req.params.guildId),
				huntId,
			})
		);
	};
	const jsonBody = [
		requireJsonCommandBody,
		json({ limit: 1024 * 1024, strict: true, inflate: false }),
	];

	router
		.route('/guilds/:guildId/hunts')
		.get(asyncHandler(listHunts))
		.post(...jsonBody, asyncHandler(createHunt))
		.all(
			methodNotAllowed(
				'GET, HEAD, POST',
				'Use GET to list hunts or POST to create a hunt.'
			)
		);
	router
		.route('/guilds/:guildId/hunts/active')
		.get(asyncHandler(readActiveHunt))
		.put(...jsonBody, asyncHandler(selectActiveHunt))
		.all(
			methodNotAllowed(
				'GET, HEAD, PUT',
				'Use GET to read or PUT to select the active hunt.'
			)
		);
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

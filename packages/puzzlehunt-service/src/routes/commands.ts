import type { RequestHandler } from 'express';
import { snowflake } from '@belle-puzzles/puzzlehunt-model/document';
import type { HuntScope } from '@belle-puzzles/puzzlehunt-model/document';
import {
	decodeHuntCommandRequest,
	decodeHuntRevision,
} from '@belle-puzzles/puzzlehunt-model/http';
import type { PuzzlehuntAppOptions } from '../app.js';

export const requireJsonCommandBody: RequestHandler = function requireJson(
	req,
	res,
	next
) {
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
};

export function createSubmitCommandHandler(
	store: Pick<PuzzlehuntAppOptions['store'], 'submit' | 'readUpdates'>
): RequestHandler {
	return async function submitCommand(req, res) {
		const since =
			req.query.since === undefined
				? undefined
				: decodeHuntRevision(req.query.since);
		const request = decodeHuntCommandRequest(req.body);
		const scope: HuntScope = {
			guildId: snowflake(req.params.guildId),
			huntId: req.params.huntId,
		};
		const result = await store.submit(scope, request);
		if (since === undefined) {
			res.json(result);
			return;
		}
		try {
			// A later consistent read may include newer writes; the original receipt stays intact.
			const update = await store.readUpdates(scope, since);
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
	};
}

import type { ErrorRequestHandler, RequestHandler } from 'express';
import { HuntCommandError } from '@belle-puzzles/puzzlehunt-model/document';
import { huntRejectionStatuses } from '@belle-puzzles/puzzlehunt-model/http';
import { HuntChangesUnavailableError } from './changes.js';

export function asyncHandler(handler: RequestHandler): RequestHandler {
	return function handleAsync(req, res, next) {
		Promise.resolve()
			.then(() => handler(req, res, next))
			.catch(next);
	};
}

export function methodNotAllowed(
	allow: string,
	message: string
): RequestHandler {
	return function rejectMethod(_req, res) {
		res.set('Allow', allow)
			.status(405)
			.json({ error: { code: 'invalid-command', message } });
	};
}

export function createErrorHandler(
	onError?: (error: unknown) => void
): ErrorRequestHandler {
	return function handleError(error: unknown, _req, res, _next) {
		if (res.headersSent) {
			(onError ?? console.error)(error);
			res.end();
			return;
		}
		if (error instanceof HuntChangesUnavailableError) {
			res.set('Retry-After', '30')
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
		(onError ?? console.error)(error);
		res.status(500).json({
			error: {
				code: 'internal-error',
				message: 'The puzzlehunt request could not be completed.',
			},
		});
	};
}

import type { RequestHandler } from 'express';
import { snowflake } from '@belle-puzzles/puzzlehunt-model/document';
import type { HuntScope } from '@belle-puzzles/puzzlehunt-model/document';
import type { PuzzlehuntAppOptions } from '../app.js';
import { HuntChangesUnavailableError } from '../changes.js';

export function createObserveChangesHandler(
	options: Pick<PuzzlehuntAppOptions, 'store' | 'changes'>
): RequestHandler {
	return async function observeChanges(req, res) {
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
	};
}

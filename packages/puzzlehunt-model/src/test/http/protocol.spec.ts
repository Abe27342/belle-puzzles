import { describe, expect, it } from 'vitest';
import { HuntCommandError } from '../../document.js';
import type { HuntCommand, HuntSnapshot } from '../../document.js';
import {
	decodeHuntCommandRequest,
	decodeHuntCommandResult,
	decodeHuntRejection,
	decodeHuntSnapshot,
	HuntProtocolError,
} from '../../http/protocol.js';

const huntId = '00000000-0000-4000-8000-000000000001';
const nodeId = '00000000-0000-4000-8000-000000000002';
const commandId = '00000000-0000-4000-8000-000000000003';
const scope = { huntId, guildId: 'guild' };
const snapshot: HuntSnapshot = {
	...scope,
	schemaVersion: 1,
	revision: 1,
	name: 'Hunt',
	configuration: {},
	document: { nodes: {} },
};

describe('Hunt HTTP protocol', () => {
	it.each<HuntCommand>([
		{
			type: 'add',
			nodes: [
				{
					id: nodeId,
					type: 'round',
					name: 'Root',
					url: '',
					parentId: null,
				},
			],
		},
		{ type: 'delete', nodeId },
		{ type: 'rename', nodeId, name: 'Renamed' },
		{ type: 'set-url', nodeId, url: 'https://example.test/puzzle' },
		{ type: 'move', nodeId, parentId: null },
		{ type: 'solve', nodeId, answer: 'ANSWER' },
		{ type: 'unsolve', nodeId },
		{ type: 'set-status', nodeId, status: null },
		{ type: 'set-status', nodeId, status: 'Working' },
		{ type: 'set-sheet', nodeId, sheetId: null },
		{ type: 'set-sheet', nodeId, sheetId: 'sheet' },
	])('decodes the public $type command', (command) => {
		expect(decodeHuntCommandRequest({ commandId, command })).toEqual({
			commandId,
			command,
		});
	});

	it.each([
		null,
		[],
		{ commandId, command: null },
		{ commandId: 'not-a-uuid', command: { type: 'delete', nodeId } },
		{ commandId, guildId: 'other', command: { type: 'delete', nodeId } },
		{ commandId, command: { type: 'set-discord', nodeId, discord: null } },
		{
			commandId,
			command: { type: 'solve', nodeId, answer: 'A', serverTime: 123 },
		},
		{ commandId, command: { type: 'set-status', nodeId } },
		{ commandId, command: { type: 'rename', nodeId, name: 7 } },
		{
			commandId,
			command: {
				type: 'add',
				nodes: [
					{
						id: nodeId,
						type: 'puzzle',
						name: '',
						url: '',
						parentId: null,
					},
				],
			},
		},
		{
			commandId,
			command: {
				type: 'add',
				nodes: [
					{
						id: nodeId,
						type: 'round',
						name: '',
						url: '',
						parentId: null,
						discord: null,
					},
				],
			},
		},
	])('rejects malformed or privileged request %#', (request) => {
		expect(() => decodeHuntCommandRequest(request)).toThrow(
			HuntCommandError
		);
	});

	it('decodes configuration, optional puzzle fields, and associations', () => {
		const puzzleId = commandId;
		const full: HuntSnapshot = {
			...snapshot,
			configuration: {
				googleFolderId: 'folder',
				indexId: 'index',
				allPuzzlesRoleId: 'all',
				loggingChannelIds: {
					puzzleAdd: 'add',
					puzzleSolve: 'solve',
					puzzleStatusUpdate: 'status',
				},
			},
			document: {
				nodes: {
					[nodeId]: {
						id: nodeId,
						type: 'round',
						name: 'Root',
						url: '',
						parentId: null,
						position: 0,
						discord: {
							channelId: 'category',
							roleId: 'role',
							indexChannelId: 'index',
						},
					},
					[puzzleId]: {
						id: puzzleId,
						type: 'puzzle',
						name: 'Puzzle',
						url: '',
						parentId: nodeId,
						position: 0,
						answer: 'ANSWER',
						status: 'Working',
						lastStatusUpdate: 1234,
						sheetId: 'sheet',
						discord: { channelId: 'channel', roleId: 'role' },
					},
				},
			},
		};
		expect(decodeHuntSnapshot(full, scope)).toEqual(full);
	});

	it.each([
		{ ...snapshot, revision: '1' },
		{ ...snapshot, revision: Number.MAX_SAFE_INTEGER + 1 },
		{ ...snapshot, schemaVersion: 2 },
		{ ...snapshot, guildId: 'other' },
		{ ...snapshot, configuration: null },
		{ ...snapshot, document: { nodes: [] } },
		{
			...snapshot,
			document: {
				nodes: {
					[nodeId]: {
						id: nodeId,
						type: 'round',
						name: '',
						url: '',
						parentId: nodeId,
						position: 0,
					},
				},
			},
		},
		{
			...snapshot,
			document: {
				nodes: {
					[nodeId]: {
						id: nodeId,
						type: 'round',
						name: '',
						url: '',
						parentId: null,
						position: 0,
						answer: 'A',
					},
				},
			},
		},
		{
			...snapshot,
			document: {
				nodes: {
					[nodeId]: {
						id: nodeId,
						type: 'puzzle',
						name: '',
						url: '',
						parentId: huntId,
						position: 0,
					},
				},
			},
		},
	])(
		'treats malformed snapshots as uncertainty, not rejection %#',
		(value) => {
			expect(() => decodeHuntSnapshot(value, scope)).toThrow(
				HuntProtocolError
			);
			try {
				decodeHuntSnapshot(value, scope);
			} catch (error) {
				expect(error).not.toBeInstanceOf(HuntCommandError);
			}
		}
	);

	it('accepts a retry receipt older than the current snapshot', () => {
		const result = {
			snapshot: { ...snapshot, revision: 3 },
			receipt: { commandId, committedRevision: 1 },
			replayed: true,
		};
		expect(decodeHuntCommandResult(result, scope, commandId)).toEqual(
			result
		);
		expect(() => decodeHuntCommandResult(result, scope, nodeId)).toThrow(
			HuntProtocolError
		);
		expect(() =>
			decodeHuntCommandResult(
				{ ...result, receipt: { commandId, committedRevision: 4 } },
				scope,
				commandId
			)
		).toThrow(HuntProtocolError);
	});

	it.each([
		['invalid-command', 400],
		['invalid-command', 413],
		['invalid-command', 415],
		['not-found', 404],
		['conflict', 409],
		['unauthorized', 401],
		['forbidden', 403],
	] as const)(
		'recognizes explicit %s rejections with status %i',
		(code, status) => {
			expect(
				decodeHuntRejection(
					{ error: { code, message: 'Rejected' } },
					status
				)
			).toMatchObject({ code, message: 'Rejected' });
		}
	);

	it.each([200, 409, 429, 500, 503])(
		'does not trust a mismatched rejection envelope at status %i',
		(status) => {
			expect(
				decodeHuntRejection(
					{ error: { code: 'invalid-command', message: 'Rejected' } },
					status
				)
			).toBeUndefined();
			expect(
				decodeHuntRejection({ error: 'Rejected' }, status)
			).toBeUndefined();
		}
	);
});

import { z } from 'zod';
import {
	validateHuntDocument,
	HuntCommandError,
	isDocumentId,
} from '../document.js';
import type {
	HuntCommand,
	HuntCommandRequest,
	HuntCommandResult,
	HuntDocument,
	HuntScope,
	HuntSnapshot,
} from '../document.js';

/** Invalid responses are uncertain outcomes, never authoritative command rejections. */
export class HuntProtocolError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'HuntProtocolError';
	}
}

const id = z.string().refine(isDocumentId, 'Expected a lowercase UUID.');
// Keep nullable fields required even in the legacy non-strict TypeScript build.
const nullableId: z.ZodType<string | null> = id.nullable();
const nullableString: z.ZodType<string | null> = z.string().nullable();
const integer = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const newNodeFields = { id, name: z.string(), url: z.string() };
const newNode = z.discriminatedUnion('type', [
	z.strictObject({
		...newNodeFields,
		type: z.literal('round'),
		parentId: nullableId,
	}),
	z.strictObject({
		...newNodeFields,
		type: z.literal('puzzle'),
		parentId: id,
	}),
]);

function propertyCommand<Property extends string, Value extends z.ZodType>(
	property: Property,
	value: Value
) {
	return z.strictObject({
		type: z.literal('set-property'),
		nodeId: id,
		property: z.literal(property),
		value,
	});
}

const command: z.ZodType<HuntCommand> = z.discriminatedUnion('type', [
	z.strictObject({ type: z.literal('add'), nodes: z.array(newNode) }),
	z.strictObject({ type: z.literal('delete'), nodeId: id }),
	z.strictObject({
		type: z.literal('move'),
		nodeId: id,
		parentId: nullableId,
	}),
	z.discriminatedUnion('property', [
		propertyCommand('name', z.string()),
		propertyCommand('url', z.string()),
		propertyCommand('answer', nullableString),
		propertyCommand('status', nullableString),
		propertyCommand('sheetId', nullableString),
	]),
]);

export const huntCommandRequestSchema: z.ZodType<HuntCommandRequest> =
	z.strictObject({
		commandId: id,
		command,
	});

const configuration = z.object({
	googleFolderId: z.string().optional(),
	indexId: z.string().optional(),
	allPuzzlesRoleId: z.string().optional(),
	loggingChannelIds: z
		.object({
			puzzleAdd: z.string(),
			puzzleSolve: z.string(),
			puzzleStatusUpdate: z.string(),
		})
		.optional(),
});
const discordFields = { channelId: z.string(), roleId: z.string() };
const nodeFields = { ...newNodeFields, position: integer };
const node = z.discriminatedUnion('type', [
	z.object({
		...nodeFields,
		type: z.literal('round'),
		parentId: nullableId,
		discord: z
			.object({ ...discordFields, indexChannelId: z.string() })
			.optional(),
		answer: z.never().optional(),
		status: z.never().optional(),
		lastStatusUpdate: z.never().optional(),
		sheetId: z.never().optional(),
	}),
	z.object({
		...nodeFields,
		type: z.literal('puzzle'),
		parentId: id,
		answer: z.string().optional(),
		status: z.string().optional(),
		lastStatusUpdate: integer.optional(),
		sheetId: z.string().optional(),
		discord: z
			.object({ ...discordFields, indexChannelId: z.never().optional() })
			.optional(),
	}),
]);
const document: z.ZodType<HuntDocument> = z
	.object({ nodes: z.record(id, node) })
	.superRefine((value, context) => {
		try {
			validateHuntDocument(value);
		} catch (error) {
			if (!(error instanceof HuntCommandError)) {
				throw error;
			}
			context.addIssue({ code: 'custom', message: error.message });
		}
	});

export const huntSnapshotSchema: z.ZodType<HuntSnapshot> = z.object({
	huntId: id,
	guildId: z.string().min(1),
	schemaVersion: z.literal(1),
	revision: integer,
	name: z.string(),
	configuration,
	document,
});

export const huntCommandResultSchema: z.ZodType<HuntCommandResult> = z
	.object({
		receipt: z.object({ commandId: id, committedRevision: integer }),
		snapshot: huntSnapshotSchema,
		replayed: z.boolean(),
	})
	.refine(
		(value) => value.receipt.committedRevision <= value.snapshot.revision,
		{
			message: 'Receipt revision exceeds the snapshot revision.',
			path: ['receipt', 'committedRevision'],
		}
	);

function response<Value>(schema: z.ZodType<Value>, value: unknown): Value {
	const result = schema.safeParse(value);
	if (!result.success) {
		throw new HuntProtocolError('Invalid puzzlehunt API response.', {
			cause: result.error,
		});
	}
	return result.data;
}

/** Public writes cannot include ownership, replacement state, or worker commands. */
export function decodeHuntCommandRequest(value: unknown): HuntCommandRequest {
	const result = huntCommandRequestSchema.safeParse(value);
	if (!result.success) {
		throw new HuntCommandError(
			'invalid-command',
			z.prettifyError(result.error)
		);
	}
	return result.data;
}

export function decodeHuntSnapshot(
	value: unknown,
	scope?: HuntScope
): HuntSnapshot {
	const snapshot = response(huntSnapshotSchema, value);
	if (
		scope &&
		(snapshot.huntId !== scope.huntId || snapshot.guildId !== scope.guildId)
	) {
		throw new HuntProtocolError(
			'Response returned a different hunt scope.'
		);
	}
	return snapshot;
}

export function decodeHuntCommandResult(
	value: unknown,
	scope: HuntScope,
	commandId: string
): HuntCommandResult {
	const result = response(huntCommandResultSchema, value);
	if (
		result.snapshot.huntId !== scope.huntId ||
		result.snapshot.guildId !== scope.guildId ||
		result.receipt.commandId !== commandId
	) {
		throw new HuntProtocolError(
			'Response returned a different hunt scope or command receipt.'
		);
	}
	return result;
}

export const huntRejectionStatuses: Readonly<
	Record<HuntCommandError['code'], readonly number[]>
> = {
	'invalid-command': [400, 405, 413, 415],
	'not-found': [404],
	conflict: [409],
	unauthorized: [401],
	forbidden: [403],
};
const rejection = z.object({
	error: z.object({
		code: z.enum([
			'invalid-command',
			'not-found',
			'conflict',
			'unauthorized',
			'forbidden',
		]),
		message: z.string(),
	}),
});

/** Only explicit, matching API rejections prove that a command was not applied. */
export function decodeHuntRejection(
	value: unknown,
	status: number
): HuntCommandError | undefined {
	const result = rejection.safeParse(value);
	if (
		result.success &&
		huntRejectionStatuses[result.data.error.code].includes(status)
	) {
		return new HuntCommandError(
			result.data.error.code,
			result.data.error.message
		);
	}
	return undefined;
}

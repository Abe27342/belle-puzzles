import { z } from 'zod';
import { validateHuntDocument, HuntCommandError, isUuid } from '../document.js';
import type {
	HuntCommand,
	HuntCommandRequest,
	HuntCommandResult,
	HuntCommandUpdateResult,
	HuntDelta,
	HuntDocument,
	HuntScope,
	HuntSnapshot,
	HuntStateUpdate,
	Snowflake,
} from '../document.js';

/** Invalid responses are uncertain outcomes, never authoritative command rejections. */
export class HuntProtocolError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'HuntProtocolError';
	}
}

/** An HTTP failure without proof that a command was rejected before committing. */
export class HuntHttpError extends Error {
	constructor(public readonly status: number) {
		super(`Puzzlehunt API returned HTTP ${status}.`);
		this.name = 'HuntHttpError';
	}
}

const snowflake: z.ZodType<Snowflake> = z.string().min(0) as any;
const optionalString: z.ZodOptional<z.ZodString> = z.string().optional();
/**
 * Useful to represent that specific properties should not be set.
 *
 * If wanting to reject keys more generally, consider using z.strictObject with z.never() for the unwanted keys.
 */
const optionalNever: z.ZodOptional<z.ZodNever> = z.never().optional();

const id = z.string().refine(isUuid, 'Expected a lowercase UUID.');
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
	googleFolderId: optionalString,
	indexId: snowflake.optional(),
	allPuzzlesRoleId: snowflake.optional(),
	loggingChannelIds: z
		.object({
			puzzleAdd: snowflake,
			puzzleSolve: snowflake,
			puzzleStatusUpdate: snowflake,
		})
		.optional(),
});

const discordFields = { channelId: snowflake, roleId: snowflake };
const nodeFields = { ...newNodeFields, position: integer };
const node = z.discriminatedUnion('type', [
	z.object({
		...nodeFields,
		type: z.literal('round'),
		parentId: nullableId,
		discord: z
			.object({ ...discordFields, indexChannelId: snowflake })
			.optional(),
		answer: optionalNever,
		status: optionalNever,
		lastStatusUpdate: optionalNever,
		sheetId: optionalNever,
	}),
	z.object({
		...nodeFields,
		type: z.literal('puzzle'),
		parentId: id,
		answer: optionalString,
		status: optionalString,
		lastStatusUpdate: integer.optional(),
		sheetId: optionalString,
		discord: z
			.object({ ...discordFields, indexChannelId: optionalNever })
			.optional(),
	}),
]);
const document: z.ZodType<HuntDocument> = z
	.object({ name: z.string(), configuration, nodes: z.record(id, node) })
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
	guildId: snowflake,
	schemaVersion: z.literal(1),
	revision: integer,
	document,
});

const delta: z.ZodType<HuntDelta> = z
	.object({
		huntId: id,
		guildId: snowflake,
		schemaVersion: z.literal(1),
		baseRevision: integer,
		revision: integer,
		name: z.string(),
		configuration,
		upsertNodes: z.array(node),
		deletedNodeIds: z.array(id),
	})
	.refine((value) => value.revision >= value.baseRevision, {
		message: 'Delta revision precedes its base.',
	});

export const huntStateUpdateSchema: z.ZodType<HuntStateUpdate> =
	z.discriminatedUnion('type', [
		z.object({ type: z.literal('snapshot'), snapshot: huntSnapshotSchema }),
		z.object({ type: z.literal('delta'), delta }),
	]);

export function huntUpdateRevision(update: HuntStateUpdate): number {
	return update.type === 'snapshot'
		? update.snapshot.revision
		: update.delta.revision;
}

export const huntCommandUpdateResultSchema: z.ZodType<HuntCommandUpdateResult> =
	z
		.object({
			receipt: z.object({ commandId: id, committedRevision: integer }),
			update: huntStateUpdateSchema,
			replayed: z.boolean(),
		})
		.refine(
			(value) =>
				value.receipt.committedRevision <=
				huntUpdateRevision(value.update),
			{
				message: 'Receipt revision exceeds the state revision.',
			}
		);

export const huntRevisionNotificationSchema = z.object({
	huntId: id,
	revision: integer,
});

export function decodeHuntRevisionNotification(
	value: unknown,
	huntId: string
): number {
	const notification = response(huntRevisionNotificationSchema, value);
	if (notification.huntId !== huntId) {
		throw new HuntProtocolError('Notification returned a different hunt.');
	}
	return notification.revision;
}

/** A synchronization cursor is not part of command identity or a write precondition. */
export function decodeHuntRevision(value: unknown): number {
	const result = z
		.string()
		.regex(/^(0|[1-9][0-9]*)$/)
		.transform(Number)
		.pipe(integer)
		.safeParse(value);
	if (!result.success) {
		throw new HuntCommandError(
			'invalid-command',
			'Expected a nonnegative safe integer revision.'
		);
	}
	return result.data;
}

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

export function decodeHuntStateUpdate(
	value: unknown,
	scope: HuntScope
): HuntStateUpdate {
	const update = response(huntStateUpdateSchema, value);
	checkUpdateScope(update, scope);
	return update;
}

function checkUpdateScope(update: HuntStateUpdate, scope: HuntScope): void {
	const state = update.type === 'snapshot' ? update.snapshot : update.delta;
	if (state.huntId !== scope.huntId || state.guildId !== scope.guildId) {
		throw new HuntProtocolError(
			'Response returned a different hunt scope.'
		);
	}
}

export function decodeHuntCommandUpdateResult(
	value: unknown,
	scope: HuntScope,
	commandId: string
): HuntCommandUpdateResult {
	const result = response(huntCommandUpdateResultSchema, value);
	checkUpdateScope(result.update, scope);
	if (result.receipt.commandId !== commandId) {
		throw new HuntProtocolError(
			'Response returned a different command receipt.'
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

import { z } from 'zod';
import { isUuid } from '../document.js';

const text = z.string().min(1);
const fluidFields = {
	fluidFileId: text,
	name: text,
	googleFolderId: text,
	indexId: text,
	allPuzzlesRoleId: text,
};

/** Legacy Fluid pins remain readable; a PostgreSQL pin is not an active-hunt pointer. */
const fluidPin = z.object(fluidFields);
const postgresPin = z.strictObject({
	version: z.literal(1),
	backend: z.literal('postgres'),
	guildId: text,
});
export type FluidHuntPin = z.infer<typeof fluidPin>;
/**
 * Versioned PostgreSQL backend marker for the bot's admin pin.
 *
 * @remarks
 * Version 1 identifies only the backend and guild, never a hunt ID, credential,
 * or service URL. The service's `active_hunts` selection, read through
 * `readActive(guildId)`, is the sole active-hunt pointer. A disabled or mismatched
 * PostgreSQL marker must fail explicitly, not fall back to Fluid or a new hunt.
 * Legacy {@link FluidHuntPin} values still select Fluid in opted-in guilds.
 */
export type PostgresHuntPin = z.infer<typeof postgresPin>;
export type PuzzlehuntPin = FluidHuntPin | PostgresHuntPin;

export function parsePuzzlehuntPin(value: unknown): PuzzlehuntPin {
	if (typeof value === 'object' && value !== null && 'backend' in value) {
		return postgresPin.parse(value);
	}
	return fluidPin.parse(value);
}

export const configuredHuntSchema = z.object({
	googleFolderId: text,
	indexId: text,
	allPuzzlesRoleId: text,
	loggingChannelIds: z.object({
		puzzleAdd: text,
		puzzleSolve: text,
		puzzleStatusUpdate: text,
	}),
});

const descriptor = z.discriminatedUnion('backend', [
	z.object({ backend: z.literal('fluid'), ...fluidFields }),
	z.object({
		backend: z.literal('postgres'),
		guildId: text,
		huntId: text.refine(isUuid, 'Expected a lowercase hunt UUID.'),
		name: text,
		configuration: configuredHuntSchema,
	}),
]);

/**
 * Public display/load metadata only. Never includes credentials or a service destination.
 *
 * @remarks
 * The bot's metadata route returns this browser-safe discriminated DTO, not a
 * live model or Discord message. Fluid retains its legacy file/name/folder/index/
 * role fields. PostgreSQL supplies the exact guild/hunt ID, name, and configured
 * folder/index/role/log-channel display metadata.
 *
 * Consumers must load the exact returned PostgreSQL scope through their configured
 * trusted HTTP origin rather than resolving active independently or trusting a
 * destination from a pin. No SSE subscription is required for this load.
 * {@link parsePuzzlehuntDescriptor} validates the shape and strips unknown fields.
 */
export type PuzzlehuntDescriptor = z.infer<typeof descriptor>;
export type PostgresHuntDescriptor = Extract<
	PuzzlehuntDescriptor,
	{ backend: 'postgres' }
>;

export function parsePuzzlehuntDescriptor(
	value: unknown
): PuzzlehuntDescriptor {
	return descriptor.parse(value);
}

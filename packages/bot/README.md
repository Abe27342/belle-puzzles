# Belle Bot

TODO: Better telemetry story.
TODO: Show error messages in a channel for the server?

TODO: Make sense of layering in this package. Right now it's set up to use a project build with tsc because
without it build times are ~3x slower due to large number of file imports from google APIs. But there are
probably more gains to be had in the realm with more sensible layering and package structure.

TODO: consider using [forever](https://www.npmjs.com/package/forever)

## Shared hunt synchronization

`sync/viewChangeHandler.ts` separates `calculateChangeWork(event)` (a pure change-to-work
calculation) from `executeChangeWork(context, guild, work, provisioning?)`. The existing
`makeViewChangeHandler` remains the Fluid subscription entry point. Plans retain historical
nodes for removals and parent/descendant scheduling; execution uses current model nodes for
channel, embed, and permission updates.

`resyncServerFull(context, guild, provisioning?)` reconciles current state when complete
historical changes are unavailable. It provisions only missing associations, then refreshes
all existing channels, embeds, and permissions through the same model-based helpers.
It cannot discover resources for already-deleted nodes without their removal snapshots.
Deletion work removes Discord resources only; Google Sheets are retained.

Both execution paths accept `SyncProvisioning` callbacks (`discord` and `googleSheet`).
These must finish association persistence and make the result visible in `context.puzzlehunt`
before resolving, so puzzle provisioning can use round associations. The default callbacks
retain Fluid's direct augmentation and puzzle-add logging.

Workers can instead use `provisionDiscordResources(context, guild, node, options?)`,
which returns association data without writing the model or emitting puzzle-add logs.
Its `existing` option accepts confirmed `role`, `channel`, and `indexChannel` IDs;
`onCreated(resource, id)` is awaited for each newly created resource. Persist these fields
independently because round channels are created concurrently, and reuse them on retries.
Both channel attempts and their checkpoints settle before a round provisioning failure is returned.
This is not exactly-once external creation: a crash after a Discord request succeeds but
before its ID is persisted can still leave an orphan.

`integrations/google.ts` already exposes `createGoogleSheet(name, folderId)` separately
from persistence; `createGoogleSheetAssociation` is the Fluid-facing wrapper. A durable
caller must save the returned sheet ID and reuse it rather than copying again on retry,
then complete associations through its trusted task boundary. This package does not yet
implement that worker or its storage. Solve/status logging remains in the Fluid commands.

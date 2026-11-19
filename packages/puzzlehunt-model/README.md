# @belle-puzzles/puzzlehunt-model

This package hosts the document model for a puzzlehunt.

Two implementations are available:

-   An implementation backed by Fluid's experimental SharedTree, generally available via `@belle-puzzles/puzzlehunt-model/fluid`
-   An implementation backed by postgres, generally available via `@belle-puzzles/puzzlehunt-model/postgres`

The latter is currently a work in progress, as there were some leaky Fluid abstractions.
The Fluid backed implementation is in the process of being retired, as Azure Fluid Relay is being sunsetted and this project's actual technical requirements do not particularly warrant using Fluid if that additionally involves the burden of running an ordering service.
See [this Github issue](https://github.com/Abe27342/belle-puzzles/issues/44) for status and relevant details.

## Creating and selecting persisted hunts

`HuntCollectionClient` (from the `/document` entry point) provides guild-level
operations separate from an already-loaded `IPuzzlehuntModel`.
`PostgresPuzzlehuntStore` (from `/postgres`) and `HttpHuntDocumentClient` (from
`/http`) implement both this capability and the existing document client:

```ts
const created = await client.create(guildId, {
	name: 'Next hunt',
	configuration: { googleFolderId: 'existing-folder-id' }, // optional
});
const model = new PuzzlehuntModel(client, created);
const listing = await client.list(guildId);
const previous = listing.hunts.find((hunt) => !hunt.active);
if (previous) {
	await client.selectActive({ guildId: listing.guildId, huntId: previous.huntId });
}
```

Creation atomically persists an empty, revision-zero hunt and selects it for the
guild. Configuration uses the common `HuntConfiguration` schema; creation does not
provision Discord channels, roles, or Google Drive resources. Listing returns
`{ guildId, hunts: [{ huntId, name, active }] }`, including inactive hunts.
Selecting a hunt validates guild ownership and changes only the active pointer.
Previous documents, revisions, command receipts, and integration work remain
stored. Existing models continue reading and editing their original hunt;
selection does not retarget open models. Use `readActive(guildId)` to resolve the
current selection and `PuzzlehuntModel.load(client, scope)` to reopen any listed hunt.

The PostgreSQL store assumes an initialized schema and caller-authorized guild
access. The HTTP client uses the service's existing Bearer/Service authorization.
Neither adapter automatically retries creation: an uncertain response may have
committed an additional hunt. List hunts and inspect the active selection before
retrying manually. Creation has no idempotency key, and these APIs do not delete
hunts.

## Trusted durable integration storage

`PostgresHuntIntegrationStore` is a worker-only capability exported from `/postgres`.
Do not expose it through user commands or general HTTP routes. `discover(guildId,
afterHuntId?, limit?)` pages all hunts in a caller-authorized guild.
`acquire(scope)` returns an `OwnedHuntIntegrations` handle, or `undefined` if another
connection owns that guild. Always `await handle.release()` in `finally`; keep the pool
open until all handles are released. The handle observes connection loss and cannot be
used after release. Session advisory locks require a direct/session-pooled connection.

The owned handle provides `dueJobs`, `startJob`, `failJob`, `dueEvents`, `startEvent`, `beginEventDelivery`,
`completeEvent`, `failEvent`, and node-operation `progress`, `beginOperation`,
`confirmOperation`, `retryOperation`, `blockProgress`. Jobs are selected parent-first
before applying the batch bound; an older pending/backed-off/paused job gates newer jobs
for the same node/target. Logs retain their distinct order; deletion tombstones can run
independently of paused logs. Attempts, due times, errors, send intent and delivery
acknowledgements are persisted. Scans are limited to 1-1000 entries per call.

`integration_progress` is node-operation bookkeeping, not hunt setup/resume tracking.
It retains independently merged confirmed IDs, actual requested names/destination IDs,
unconfirmed intents and blocking
diagnostics across job completion, node deletion, and process restart. Only clear an
intent with `retryOperation` when a service definitively did not perform the operation.
An unresolved intent or blocked target requires manual inspection; a new task must
not adopt or recreate those resources automatically.

`completeWork(scope, workId, result?)` still atomically persists an optional association
and completes just that job using the work-ID receipt. It now also compares the current
association against the job's enqueue-time association under the authoritative hunt
lock. Changed/manual associations reject stale results; same-task receipt retries
remain idempotent and do not replay writes over newer state. Cancelled/replaced nodes
cannot gain results. Completion does not enqueue follow-up integration jobs/events;
workers must reconcile derived Discord state after completion and periodically.

These additions are part of the opt-in `schema.sql`; use an initialized schema containing
the new columns/table. This package does not add schema-only initialization or a migration
runner.

## Testing

Models are tested using contract-based tests running against local databases/services.
This means using azure-local-server for the Fluid backed implementation, and a disposable native PostgreSQL service for the postgres model implementation.

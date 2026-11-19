# Belle Bot

TODO: Better telemetry story.
TODO: Show error messages in a channel for the server?

TODO: Make sense of layering in this package. Right now it's set up to use a project build with tsc because
without it build times are ~3x slower due to large number of file imports from google APIs. But there are
probably more gains to be had in the realm with more sensible layering and package structure.

TODO: consider using [forever](https://www.npmjs.com/package/forever)

## Opt-in durable integration worker

`sync/durableWorker.ts` exports `createDurableIntegrationWorker(options)` and
`DurableIntegrationWorker`. Construction/import does not start anything; the default bot
startup and deployed Fluid behavior are unchanged. The backend owner supplies:

```ts
const worker = createDurableIntegrationWorker({
	documents: new PostgresPuzzlehuntStore(pool),
	integrations: new PostgresHuntIntegrationStore(pool),
	authorizedGuildIds: configuredGuildIds,
	getGuild: loadAuthorizedGuild,
	onError: (error, scope) => console.error(scope, error),
});
await worker.start(); // One bounded startup pass, then non-overlapping periodic passes.
// await worker.reconcile(); // Explicit bounded catch-up; joins an in-flight pass.
await worker.stop(); // Stop admission, settle current work, release database ownership.
```

Solve/status logging remains in the Fluid commands; PostgreSQL command wiring must not
also send these direct logs.

Use the model package's `/postgres` exports for the stores and a caller-owned `pg` pool.
The pool must support **session** advisory locks (not transaction-mode PgBouncer) and have
at least two connections: one held ownership connection and one for document reads/writes.
Shut down the worker before closing the pool. `getGuild` must return the authorized guild
with its role/channel caches populated. Configure that Discord client with
`rest: { retries: 0 }`: SDK transport retries can duplicate creates/sends after lost responses,
so the worker refuses clients with automatic retries enabled. Google copies explicitly
disable transport retries and use a 30-second request timeout. A separate local client can keep the deployed Fluid
client's configuration unchanged.

The worker discovers **all** stored hunts in each authorized guild, including inactive
hunts; selection does not cancel already committed work. There is no dependency on browser
access, model caches, SSE, or notification hints. A PostgreSQL advisory lock excludes a
second worker for the entire guild, even for another hunt. Ownership is released after each
pass or shutdown; a lost connection stops further bookkeeping/operation admission.

Default bounds are 10 hunts per guild, 50 jobs, 50 events and 50 reconciliation nodes per
hunt per pass, at 30-second intervals. Override `huntsPerGuild`, `jobsPerHunt`,
`eventsPerHunt`, `nodesPerHunt`, and `intervalMs` as needed (batch sizes 1-1000).
Round-robin hunt/node cursors ensure successive passes cover larger hunts; cursors may
restart from the beginning after a process restart, but committed work is never discarded.
Each desired-state job reads a new committed document/configuration; it never provisions
from an optimistic model or its historical job payload. Ancestor jobs are selected before
dependents, and subsequent work reads acknowledged associations. Hunts need nonempty
`googleFolderId`, `indexId`, and `allPuzzlesRoleId`, plus an available index category and
all-puzzles role in that guild, before any node provisioning or derived sends. Setup of
these resources remains outside this worker.

Provisioning uses the shared `provisionDiscordResources` with `onCreating`,
`onCreated`, and `onCreateFailed` checkpoints, and `createGoogleSheet`. Confirmed results
are completed through the trusted store, not through general document writes. Periodic
`syncCurrentNode` calls reuse the same channel/embed/permission logic as full Fluid resync,
including old/new parent membership, puzzle category movement, ancestor permissions, and
repair after a crash between completion and derived sync. These passes create no missing
associations themselves and do not synthesize historical logs.

Add/solve/status events retain their own payload and delivery acknowledgement, in order.
The enqueue-time parent name is included for puzzle-add messages even if the round is
later removed. Events without configured logging are acknowledged without sending.
Deletion tombstones are independent of blocked log delivery: recorded Discord IDs are
deleted idempotently; Google Sheets are always retained.

External effects are **not exactly-once**. Persisted intent precedes each create/send,
including the actual requested name and destination IDs for manual inspection.
Confirmed resource/message IDs are reused, including an embed sent but not yet pinned.
A timeout, lost response, interrupted intent, or unacknowledged log send pauses that
node/target or log stream with manual-inspection diagnostics instead of repeating it.
Later jobs cannot bypass a paused node/target. A stale completion cannot overwrite a
manual/newer association; confirmed but rejected results remain recorded for inspection.
Node deletion retains and blocks progress, including if an ID is reused by a replacement.
There is deliberately no setup ledger, automatic adoption, or general resume CLI.

Known no-effect rejections back off with persisted attempts/errors/due times
(`retryBaseMs`: 30 seconds; `retryMaxMs`: one hour). Selected Discord 4xx responses are
recognized; other errors are conservative unless `isKnownNoEffect(error)` proves that
the external service performed no operation. Never classify timeouts or failed
checkpoints as safe. `createSheet` is injectable for tests; all tests use disposable
native PostgreSQL and mocked Discord/Google operations, not real services or secrets.

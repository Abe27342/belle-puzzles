# Initial database document model

## Status and boundaries

This is an opt-in foundation, not a cutover. The existing Fluid exports, bot
commands, Discord event handlers, website components, and pinned hunt-context
messages remain unchanged. Their startup opens no new database connection; only
the explicitly started application service connects to PostgreSQL.

Implemented:

- The Fluid-independent `@belle-puzzles/puzzlehunt-model/document` entry point:
  snapshots, semantic commands, invariant checks, command application, async
  read/write contracts, and a synchronous view projection.
- A common generic `IPuzzlehunt` for reads/mutations, specialized by legacy Fluid
  handles and by `IPuzzlehuntModel` with plain views and synchronous local mutations.
  `PuzzlehuntModel` in the `model` entry point tracks optimistic commands over
  `HuntDocumentClient`; `FluidPuzzlehuntModel` in `fluid` delegates to the existing
  Fluid implementation with stable string IDs and storage-neutral notifications.
- `PostgresPuzzlehuntStore` in the model package's server-only `postgres` entry
  point: scoped reads and serialized transactional
  commands, retry receipts, durable integration intent, and conditional
  reconciliation acknowledgement. Its injected pool is a structural subset of
  `pg.Pool`.
- A browser-safe `http` adapter for that same `HuntDocumentClient` interface,
  plus the independent `packages/puzzlehunt-service` Express executable with
  a PostgreSQL pool, scoped routes, JSON validation, Discord authorization,
  and graceful shutdown. See [the service guide](../puzzlehunt-service/README.md)
  for configuration and usage.
- An initial PostgreSQL schema in `packages/puzzlehunt-model/src/postgres/schema.sql`, exercised
  with an ephemeral in-memory PGlite database. PGlite is a test dependency, not the
  proposed production database. This revises the initial, unapplied schema;
  it is not an upgrade migration for an existing JSONB database.
- One representation-independent behavioral suite against the local Fluid
  ordering service and a disposable, multi-connection PostgreSQL service, plus
  focused optimistic-client and authoritative concurrency tests.

Not implemented: React bindings, SSE delivery/reconnection, external integration
workers, hunt provisioning/import, database migration tooling, and deployment.
Local HTTP-plus-database application tests are intentionally deferred; the app
factory preserves injectable database and authorization boundaries for them.
These follow-up pieces remain prerequisites for production cutover. The independent
Fluid export format is not a dependency or this schema.

See [the architectural decision record](ARCHITECTURE_DECISIONS.md) for package
boundaries, the optimistic model direction, and the local-service test strategy.

## Representation

Use PostgreSQL with one metadata row per hunt and one typed `hunt_nodes` row per
round or puzzle. Database constraints enforce fundamental node properties and
parent relationships. Commands still serialize short transactions per hunt;
normalizing node storage does not require per-node locking. Separate hunts do
not share an application lock.

`hunts` stores stable UUID identity, guild ownership, name, schema version,
monotonic revision, configuration, optional source provenance, and
timestamps. Configuration brings the existing Google folder, Discord index and
all-puzzles role IDs, and logging channel IDs out of pinned messages/SharedMap.
Hunt/guild identity is outside the editable document and absent from commands.
The configuration also has no generic user-patch command in this initial model.
`active_hunts` explicitly selects one hunt per guild while retaining archived
hunts; its composite foreign key prevents a cross-guild pointer.

`hunt_nodes` contains UUID identity, a round/puzzle discriminator, name, URL,
parent ID, and sibling position, plus nullable puzzle and Discord properties.
Its primary key is `(hunt_id, id)`. A composite foreign key requires the parent
to be an existing round in the same hunt. The generated `parent_type` column is
always `'round'`; it is a constraint helper, not separately editable tree state.
Only rounds may have a null parent, meaning a top-level child of the implicit
hunt root.

SQL checks restrict answers, statuses, status timestamps, and sheet IDs to
puzzles; require status and its timestamp together; and require complete Discord
associations, with an index channel for rounds only. Positions and status times
are nonnegative integers bounded to JavaScript's safe integer range. Separate
unique indexes enforce sibling positions for roots and non-roots, including the
null-parent case, and also support ordered child lookup.

Self-parenting is rejected in SQL. Longer cycles are checked by the command
model before writing, while holding the hunt row lock through commit. This is
the deliberately controlled write protocol, not a database cycle trigger:
imports and maintenance writers must also lock the hunt and validate the final
graph. Concurrent commands cannot both validate against a stale tree because
the later lock holder reads fresh committed nodes before applying its command.
Uncontrolled direct SQL could still introduce a longer cycle.

Stable IDs are not Fluid local node numbers or Discord IDs. An importer must
allocate/remap IDs, preserve external associations and provenance, and validate
the resulting graph. New node creations use fresh random UUIDs. Existing node
IDs collide with the primary key; no permanent record is retained after deletion.

Persist only parent pointers; derive children. Additions and reparenting append
to the current destination's sibling positions. Positions need not be contiguous
after removal, but must be unique per parent. Moving to the same parent does not
reorder. Arbitrary sibling reordering is not an existing mutation surface and
has no new command here. Deleting a round deletes its current authoritative
subtree, including additions committed before that deletion. An add targeting a
round deleted earlier fails explicitly.

Puzzle fields include optional answer, status, last-status-update time, Google
sheet ID, and Discord associations. Optional SQL columns use `NULL`; snapshots
omit absent properties, and commands use explicit `null`, never JSON-ambiguous
`undefined`. Status and its timestamp are present/absent together. A Discord round
association additionally requires an index channel. Google sheets are retained
when a node is deleted, matching existing behavior.

The public `HuntSnapshot.document.nodes` map is assembled from these rows; it is
not a JSONB storage column. A snapshot read uses one SQL statement so metadata,
revision, and nodes share the same MVCC snapshot, even during concurrent writes.
SQL JSON aggregation and batch JSON parameters are query/transport encoding only.
JSONB remains for configuration, provenance, command receipts, and event payloads.

## Commands, ordering, and retries

The public command vocabulary is `add`, `delete`, `move`, and `set-property`.
Property names are the typed union `name`, `url`, `answer`, `status`, and `sheetId`,
with their corresponding value types. Nullable properties use `null` to clear;
setting/clearing `answer` expresses solve/unsolve. A separate worker-only
`set-property` command attaches/clears `discord` resources. Both existing bulk
creation methods map to one `add` command; parents must precede their children
within a batch. All callers send IDs and intent, never a replacement snapshot or
a client-computed tree diff.

The store performs the following on a single leased connection at PostgreSQL's
default READ COMMITTED isolation:

1. Begin; select the hunt by both hunt ID and authorized guild ID `FOR UPDATE`.
   After acquiring the lock, read the snapshot in a new statement so a waiting
   command sees node changes committed by the previous lock holder.
2. Read the command receipt under that same lock. A retry of the same JSON
   command returns its original committed revision plus the current snapshot,
   with `replayed: true`; it does not apply the command again. Reusing an ID for
   different JSON intent is a conflict.
3. Apply the command to freshly read authoritative state. Sample database time
   after acquiring the lock for status timestamps. Validate the complete graph
   before writing.
4. Insert/update only changed node rows and delete removed nodes as a batch;
   increment the hunt revision and insert the command receipt, coalescing
   integration jobs, and separate lifecycle/log events. Foreign keys prevent a
   standalone parent deletion while children still reference it; a subtree
   deletion removes all its rows in one statement.
5. Transactionally `pg_notify` a small hunt/revision hint and commit. Return only
   committed state. On failure roll back all the records together.

Use a new command UUID for each intentional action and keep that same UUID and
payload across a network retry. Keep receipts indefinitely
initially; pruning requires an explicit retry-expiration protocol. A request
whose commit result is unknown is retried with the same ID, never a fresh one.

Ordinary assignments have no blanket expected-node-version requirement. If two
clients solve the same puzzle, the later serialized database write wins,
regardless of their clocks, request start times, or stale reads. Independent
adds both survive; changing one field preserves fresh values of other fields.
Structural invalidity (missing parent, cycle, duplicate existing ID) fails explicitly rather
than silently dropping a command. Each newly accepted command advances the hunt
revision, even if its assignment happens to equal the existing value.

**User-confirmed new-path behavior:** solving atomically sets the answer and
clears status and its timestamp, and records a distinct solve event for a log on
either Discord or the website. Current Fluid website solves do not clear status
or log, so this is an intentional unification only on the opt-in path. Explicit
re-solves with fresh command IDs are separate loggable actions. Unsolve removes
the answer, leaves any current status alone, and has no solve log, matching the
current Discord unsolve intent. Status assignments/clears record their own events;
solving does not emit an additional status-cleared log.

## Exposing committed state to views

`HuntDocumentClient` separates asynchronous `read`/`submit` from synchronous
`projectHuntDocument(snapshot)`. The projection returns root rounds, all rounds,
puzzles, and ordered `childrenByRound`; it does not contain mutable setters,
Fluid handles, or `TreeView`. Its objects are read-only by TypeScript contract,
not recursively frozen/copied. Treat a snapshot as immutable and replace it when
a newer committed snapshot arrives.

The optional model facade adds familiar getters/mutations over this boundary:

```ts
import { PuzzlehuntModel } from '@belle-puzzles/puzzlehunt-model/model';

const model = await PuzzlehuntModel.load(client, scope);
const stopListening = model.subscribe(() => render(model.view));
const round = model.addRound('Round', 'round-url');
model.addPuzzle('Puzzle', 'puzzle-url', round); // visible locally immediately
await model.flush(); // confirmation, not a fire-and-forget write
stopListening();
```

`client` implements the existing `HuntDocumentClient`; it may be a local store or
the authenticated `HttpHuntDocumentClient` from the `http` entry point. Public
model code imports no PostgreSQL or Fluid implementation. `committedSnapshot` remains authoritative;
`view` includes provisional changes, and `isPending`/`pendingChanges` distinguish
them. Definitive failures roll back and stay in `failures`; dependent edits fail
explicitly and independent edits survive. Unknown outcomes pause with the
original command ID for `retryPending()`. `refresh()` shares the command queue to
avoid applying accepted pending commands twice. See the decision record for this
simple protocol's latency trade-off and the legacy Fluid adapter's semantics.

Authenticated routes in the opt-in application service:

| Route | Contract |
| --- | --- |
| `GET /guilds/:guildId/hunts/active` | Resolve `active_hunts` and return its `HuntSnapshot`; leave the existing Fluid-context endpoint unchanged. |
| `GET /guilds/:guildId/hunts/:huntId` | Return `HuntSnapshot`. |
| `POST /guilds/:guildId/hunts/:huntId/commands` | Accept `HuntCommandRequest`; return `HuntCommandResult` after commit. |

The separate service's Discord authorizer permits reads and edits by current
guild members using OAuth tokens with the existing `guilds` scope. Optional
trusted-bot credentials are separate from Discord tokens and limited by the
configured bot's guild access. This policy was explicitly confirmed by the user.

The HTTP boundary uses shared Zod schemas to decode/validate unknown JSON, enforces a 1 MiB request limit
and the public command allowlist, and authorizes before invoking the store.
The model's typed `validateHuntDocument` invariant checker is not a JSON decoder.
The store's guild predicate is defense in depth, not authentication. Never accept
the guild, active-hunt selection, configuration, or integration-only commands from
freely editable document JSON. Map domain errors to user-facing 400/404/409
responses, and authentication failures to 401/403. Propagate other errors explicitly
and do not report success until the transaction commits. The client treats
network failures, invalid responses, and 5xx results as uncertain, keeping the
original command ID. Only matching explicit API rejection envelopes allow rollback.

All responses use `Cache-Control: no-store`; there is no ETag/cache protocol yet.
Authorized SSE invalidations at `/guilds/:guildId/hunts/:huntId/changes` and
reconnection handling are proposed follow-up work, not registered routes.
The [decision record, sections 12-13](ARCHITECTURE_DECISIONS.md#12-change-notification-architectures)
compares polling, PostgreSQL-backed SSE, and managed fan-out, and evaluates SQL
organization/type-generation alternatives. These are proposals, not implemented
notification infrastructure or a selected query tool.

The shared model may expose synchronous mutations over an optimistic projection:
the latest committed snapshot with pending semantic commands reapplied. Local
visibility is not durable commitment, just as with Fluid. Pending changes,
authoritative rejection, and settlement must be observable; callers that announce
success must await settlement. The model submits commands, not its projected
snapshot, and reconciles acknowledgements before reapplying pending commands.
Use string IDs (`data-node-id`), not numeric DOM-ID parsing. Do not mark optimistic
data as committed. React/modal wiring remains outside this prototype.

Only replace a cached snapshot if its scope matches and its revision is not
older. Command responses and refetches can arrive out of order. A replay response
can include state newer than its receipt; never treat the receipt revision as the
snapshot revision. SSE/change hints invalidate/refetch when ahead of the cache.
Refetch on reconnect and periodically while visible; no missed notification may
leave a client permanently stale. On guild/hunt navigation, discard old-scope
requests and subscriptions. No offline command queue or disconnected-edit merge
protocol is planned.

The bot and website should use the same authenticated HTTP command service for
slash commands, bulk creation, and Discord drag/reparent events (`client.ts`).
Integration association writes use a separate worker-only service boundary.
Do not continue interpreting low-level Fluid deltas on this path. Its renderers
can use the same snapshot projection without depending on React. Integration
workers belong to the application service, not specifically the Discord gateway
process; initial cohosting does not require keeping those responsibilities coupled.

## Local model evaluation

Run `pnpm --filter @belle-puzzles/puzzlehunt-model test:contract` for the same
behavioral assertions on both model implementations. Run
`pnpm --filter @belle-puzzles/puzzlehunt-model test` for the full model suite,
including the existing Fluid tests, PGlite schema tests, optimistic failure/retry
tests, and real PostgreSQL contention tests.

Vitest global setup starts and checks an isolated local ordering service and
returns its teardown. Tests receive its endpoint through typed `provide`/`inject`;
an optional `PUZZLEHUNT_FLUID_ENDPOINT` selects an externally owned service instead.
There is no outer test-runner script or WMIC dependency. Database fixtures
start real PostgreSQL on dynamic loopback ports and clear their own tables before
each test. They never accept an external database URL or reset a user database.
Services and their temporary data are cleaned up afterward. Native PostgreSQL
test binaries are development dependencies; use a non-root account on Unix.

## Durable Discord and Google work

Every successful new command atomically upserts one `integration_jobs` row per
target (`discord`, `google`), recording the desired revision. This deliberately
coarse hunt-level queue avoids a per-field dependency graph at current scale.
Read current desired state, not the old command snapshot, for state refreshes:
names, answers, topics, indexes, membership/permission changes, and associations.
A round rename/move can affect descendant permissions and both old/new indexes,
so reconcile the whole relevant hunt, not just the edited node.

On startup and periodically, workers scan persisted pending jobs/events even if
no notification arrives. Run external calls outside hunt transactions and apply
bounded retries/backoff, persisted attempt/error details, and operator-visible
failures. A worker records the requested generation it read. On completion,
`acknowledgeReconciliation(scope, target, requestedRevision)` deletes only that
generation. A newer mutation leaves its pending job intact. An intervening
association write also advances the revision and schedules another pass; only
write associations when the desired value actually changes, allowing convergence.
Retain an existing job's backoff on a new change rather than retrying a broken
integration on every edit.

`integration_events` records every add/delete/solve/status action separately,
keyed by hunt, command, and event ordinal, with event-time node data and logging
configuration. Distinct logs must not coalesce, and a deletion tombstone preserves
resource IDs after the node leaves the current document. Do not send logs directly
from request handlers. Skip log delivery when the event's logging target is
unconfigured; resource cleanup is independent of logging configuration.

**Worker implementation is still required; an outbox alone is not exactly-once
integration.** Before enabling workers, implement durable resource-creation
progress and worker ownership/leases, not just a loop over pending rows:

- Each channel/category/role/sheet creation step needs a stable intent identity
  and durable external-ID journal. Reconcile/discover existing resources on
  retries. A crash after external creation but before storing its ID is ambiguous
  and can produce duplicates; document detection/repair rather than claiming
  exactly-once delivery.
- A create racing with deletion must not attach an external resource to a missing
  node. New creations use fresh UUIDs; a journaled resource that can no
  longer be attached becomes cleanup work. Deletion events alone cannot know
  about resources created after their tombstone was recorded. Retain the journal
  until those resources are accounted for. Resource attachment also needs a
  field-specific condition checked against fresh state: a late create must not
  overwrite a sheet/Discord association changed while its external call was in
  flight. The initial assignment primitives are not that complete worker
  protocol. Do not delete Google sheets, including duplicate/orphaned sheets.
- Serialize/lease work per hunt/target across processes so an older external pass
  cannot overwrite a newer completed pass. Conditional queue acknowledgement
  prevents lost work but does not by itself fence stale external side effects.
  Lease expiry also needs recovery of still-running calls and a final fresh-state
  pass; never hold a hunt row lock across an external call.
- Mark distinct event delivery only after external success. Logs can duplicate
  after a crash between send and acknowledgement unless the external API provides
  an applicable idempotency key or discoverable message identity. Preserve
  retryability and report the limitation.

PostgreSQL notifications are only prompt wake-ups. Use a dedicated direct
`LISTEN` connection, not a transaction-pooled connection, and rescan/reconnect on
listener loss. Never broadcast notifications to unauthenticated SSE clients.

## Hosting and rollout

Assume Azure PostgreSQL B1ms (about 1 vCore / 2 GiB) as a starting budget/size, not
a throughput guarantee or a quoted price. At low usage, keep a small bounded pool,
short transactions, indexed pending-work scans, and idle backoff. Measure document
sizes, lock waits, pending-work age, errors, and connection count. Co-host the
application service with the existing long-lived Container App initially; a
separate API/worker container can follow without changing the model contract.
Use separate database credentials/roles and TLS configuration at deployment;
no resources are provisioned by this change.

Before cutover: test the store against real PostgreSQL with independently leased
connections, complete scoped auth/JSON decoding and async UI adapters, implement
and failure-test the resource journal/worker protocol, create an audited import
with ID/provenance mapping, and define backup/restore and
rollback procedures. The current embedded tests execute PostgreSQL SQL and
transaction rollback but use a size-one pool; they are not evidence of production
multi-connection locking, external API idempotence, or a completed migration.

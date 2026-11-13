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
  commands, retry receipts, and durable integration intent.
  `PostgresHuntIntegrationStore` separately owns worker association writes and
  conditional reconciliation acknowledgement. Both accept a structural subset of
  `pg.Pool` and can use independent instances/pools.
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

Not implemented: React bindings, external integration
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

The public `HuntSnapshot` contains ownership, schema version, revision, and a
`document` with `name`, `configuration`, and the `nodes` map assembled from these
rows. The document is not a JSONB storage column. A snapshot read uses one SQL
statement so metadata, revision, and nodes share the same MVCC snapshot, even
during concurrent writes.
SQL JSON aggregation and batch JSON parameters are query/transport encoding only.
JSONB remains for configuration, provenance, command receipts, and event payloads.

## Commands, ordering, and retries

The public command vocabulary is `add`, `delete`, `move`, and `set-property`.
Property names are the typed union `name`, `url`, `answer`, `status`, and `sheetId`,
with their corresponding value types. Nullable properties use `null` to clear;
setting/clearing `answer` expresses solve/unsolve. A separate worker-only
`set-property` command attaches/clears `discord` resources. Both existing bulk
creation methods map to one `add` command; parents must exist in the final graph,
but may appear later in the same batch. Creation accepts structural fields only;
answer/status, sheet, and Discord associations must be
assigned afterward. The reducer explicitly rejects these fields (and a supplied
position) on creation rather than silently discarding them.
All callers send IDs and intent, never a replacement snapshot or a
client-computed tree diff.

Each command builds an internal forest with an ID map, parent/child pointers,
and per-parent append positions. Graph validation memoizes completed ancestry
paths; deletion traverses only the indexed subtree. Bulk additions allocate
positions without rescanning existing siblings. These operations are linear in
document/batch size apart from sorting siblings for deletion event order, and
deep graph validation/deletion use iterative traversal. The index is temporary,
not another persisted source of truth. Final-state validation still checks the
complete resulting graph before any write.

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
The application service, not a store convenience method, explicitly submits the
command and then reads an incremental synchronization response when requested.

All responses use `Cache-Control: no-store`; there is no ETag/cache protocol yet.
Authorized SSE notifications at `/guilds/:guildId/hunts/:huntId/changes` and
HTTP model reconnection/catch-up handling are implemented as opt-in APIs.
The [decision record, sections 12-13](ARCHITECTURE_DECISIONS.md#12-change-notification-architectures)
compares polling, PostgreSQL-backed SSE, and managed fan-out, and evaluates SQL
organization/type-generation alternatives. SSE plus PostgreSQL `LISTEN` is now the
user-selected direction. The protocol below describes the implementation;
no query tool has been selected.

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

## Change notification protocol

**Status:** Implemented in the PostgreSQL store, standalone service, and HTTP
adapter. Legacy Fluid consumers are unchanged; deployment and integration worker
execution remain separate work.

Keep initial full-snapshot reads and mutation semantics. Extend reads and command
responses to support incremental synchronization. Add one observation-only stream
per hunt, with one application event type: `revision`. Its first message also
serves as the initial synchronization handshake; no separate ready, reset,
snapshot, or command-acknowledgement events are needed in that stream.

### Wire shape

```http
GET /guilds/:guildId/hunts/:huntId/changes
Authorization: Bearer <Discord OAuth token>
Accept: text/event-stream
```

Trusted processes use the existing `Authorization: Service <credential>` scheme.
Use fetch-based streaming so both authorization schemes work without credentials
in URLs or a new cookie policy. Apply the existing guild/hunt ownership checks
and CORS allowlist.

```text
HTTP/1.1 200 OK
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-store, no-transform

event: revision
data: {"huntId":"00000000-0000-4000-8000-000000000001","revision":42}

: keepalive

event: revision
data: {"huntId":"00000000-0000-4000-8000-000000000001","revision":45}

```

Each frame ends with a blank line. The JSON payload reuses the existing database
hint shape: `huntId` is the requested UUID and `revision` is a nonnegative safe
integer. Validate it with a shared Zod schema and check the requested scope.
Additional payload fields may be ignored, as with existing response schemas.
SSE comments are transport keepalives, not model changes. Flush complete frames
promptly rather than buffering the whole HTTP response.

A revision message means **the hunt has committed at least this revision**.
Messages may skip revisions or coalesce many changes; they contain neither
document patches nor durable integration work. There are no SSE `id` fields,
stream replay cursors, `Last-Event-ID` semantics, or client acknowledgements.
Recover through revision-relative state reads, not by requesting missed SSE
messages.

### Incremental state synchronization

The original full-snapshot refresh proposal has a cost proportional to the whole
hunt for each refresh; notification coalescing alone does not address it. Instead,
the client supplies its committed revision as a synchronization cursor. The
response covers a complete interval from `baseRevision` to `revision`, with
`upsertNodes` containing complete authoritative records for affected surviving
nodes and `deletedNodeIds` identifying removals. Include current hunt metadata and
configuration as well, rather than losing changes outside node properties.

Coalesce each affected node to its final state for that interval. These are state
replacements, not domain commands or property patches: clients need not reproduce
server timestamps, solve/status side effects, or integration behavior. Assemble
the update and its ending revision from the same consistent database snapshot.

Initial loads return a full snapshot. Retain bounded, transactionally recorded
change tracking, including deletions, for catch-up reads. Reuse the store's
existing changed/removed-node detection, recording synchronization tracking in
the same transaction as state, receipts, integration intent, and notification.
The `hunt_changes` table records affected UUIDs for each revision, including
empty lists for no-op revisions. Retain the newest 1000 revisions per hunt;
older tracking is removed by subsequent command transactions. IDs are not
reserved after deletion. Reads join affected IDs to current typed node rows to
obtain final after-images and deletions, instead of storing another JSON document.
Do not repurpose the integration outbox: it has different contents and retention
semantics. If the retained tracking cannot cover the entire requested interval,
return an explicit full-snapshot fallback, never a partial delta.

The indexed deletion keeps a revision-count bound without a scheduled cleanup
process. PostgreSQL has no built-in policy for retaining the newest N rows per
hunt; soft deletion would still need cleanup and would unnecessarily change
authoritative node storage. Time-based partitioning or scheduled retention can
be revisited if usage warrants it. This tracking is independent of durable
integration deletion events and command receipts.

Use the same full-or-incremental response mechanism for command acknowledgements,
so editing clients also avoid repeated full transfers. The synchronization
cursor is outside command intent and receipt deduplication: it is not an
expected-version write precondition. Apply commands to fresh authoritative state
regardless of how far behind the client's cursor is. Retrying retains the
original command ID and intent; return its receipt with an update to current
state without reapplying the command.

`GET /guilds/:guildId/hunts/:huntId?since=R` returns `HuntStateUpdate`, either
`{ type: 'delta', delta: { huntId, guildId, schemaVersion, baseRevision, revision,
name, configuration, upsertNodes, deletedNodeIds } }` or
`{ type: 'snapshot', snapshot: HuntSnapshot }`. Without `since`, GET retains its
original full `HuntSnapshot` response.

`POST /guilds/:guildId/hunts/:huntId/commands?since=R` returns
`{ receipt, replayed, update: HuntStateUpdate }`. Without `since`, it retains
`{ receipt, replayed, snapshot }`. Query cursors are validated before application
and never included in the command body. The incremental acknowledgement reads
current state after commit; any failure of that read is a 5xx uncertainty, not
a definitive command rejection.

The HTTP adapter keeps immutable authoritative snapshots by scope and uses the
captured request base to assemble updates. It still exposes the original
`HuntDocumentClient` snapshot/receipt contract to `PuzzlehuntModel`, avoiding a
second optimistic facade or transport-specific model branches. Concurrent
responses cannot change another request's assembly base or regress this cache.
An unexpected delta base triggers a full read, never another command submission.

### Subscription ordering and recovery

Before accepting subscriptions, establish and commit the replica's dedicated
database `LISTEN`. For each connection:

1. Authenticate and register the scoped subscriber, buffering only its highest
   notified revision while initializing.
2. Read the current revision with both hunt ID and guild ID predicates. Return
   the existing JSON 404 response if the hunt does not belong to that guild.
3. Begin the 200 stream and send the higher of the read revision and any buffered
   notification. Thereafter send only increasing revisions for that connection.

This closes the read/subscribe race without an SSE replay log. Clients may load the
ordinary snapshot first, then connect: a commit in between appears in the first
revision message or a subsequent one. Reconnecting to any replica uses the same
procedure. Slow subscribers need only a bounded high-water mark, not a growing
event queue; close the stream if its transport buffer cannot drain.

If the database listener fails, close its affected streams and log the cause.
Reject new streams with a transient 503 until listening is restored. Do not keep
sending heartbeats on a stream whose change source is known to be disconnected.
If this happens during initialization, abort that subscription rather than
finishing its handshake.

### Applying notifications to a model

Track the highest announced revision. If `committedSnapshot.revision` is already
at least that value, no read is needed. Otherwise mark a refresh needed and
coalesce notifications into one outstanding queued catch-up read from the
committed revision. A command response may catch the model up without an
additional read. Continue consuming the stream while waiting for the model queue.

Apply a delta only against its stated committed base revision, validate the
resulting authoritative state, and then rebase pending commands. A mismatched
base requires resynchronization, not applying an update to optimistic state or
rejecting an otherwise valid mutation.

The current `refresh()` promise describes batch settlement, not completion of
one refresh operation. In particular, a rejected promise while a command is
uncertain does not remove its queued refresh. `refresh(targetRevision?)` now coalesces against the actual queue and skips hints
covered by command responses. The watcher retains the dirty revision while
paused and does not request another refresh behind an uncertain command.

Never install a snapshot directly from this path, retire a command because of a
revision hint, or automatically call `retryPending()`. A command with an uncertain
outcome still pauses the existing queue; the model can remain behind the announced
revision until that command is resolved. Connection/freshness state must remain
separate from pending-edit/commit state. Neither a stream message nor a stream
error proves that a pending mutation succeeded or failed.

### Connection lifetime and failures

Before streaming begins, use the existing JSON error envelope and status codes.
Once 200 headers have been sent, log server failures and close the connection;
do not insert an ordinary JSON error response into the SSE body.

| Condition | Client behavior |
| --- | --- |
| Normal EOF, network interruption, 429, or 5xx | Reconnect with capped backoff and jitter; the new first revision detects missed changes. Honor `Retry-After` when supplied, exposing that header through CORS. |
| 401 | Pause observation attempts until the authentication layer obtains valid credentials. |
| 403 or 404 | Stop automatic observation attempts for this scope and surface the error; do not silently switch hunts. |
| Malformed known event, wrong hunt ID, or unexpected successful response type | Surface a protocol error and stop automatic retries until explicitly restarted. |
| Page/model disposal or scope change | Abort the old stream without reconnecting. |

Ignore comments and unrecognized event names for forward compatibility, but
do not silently discard malformed `revision` messages. Read credentials again
for every connection. Reconnection applies to observation requests only, not
automatic retries of mutation requests.

Implemented defaults, not additional wire fields: a keepalive every
15 seconds, a 45-second no-data watchdog, planned stream rotation after about
180 seconds, and failure backoff growing from about 1 to 30 seconds with jitter.
These bound authorization lifetime and accommodate the documented Container Apps
request timeout; verify proxy streaming behavior before deployment. The existing
30-second REST request timeout must not be applied to the stream. Also coalesce
incremental safety refreshes about once a minute while the page is visible and on
focus/network recovery, so a missed hint cannot leave a client permanently stale.

### Bot and worker scope

A bot model uses this same protocol. An integration worker may use the stream or
direct database `LISTEN` as a wake-up source, but must scan durable jobs/events on
startup, on a wake-up, and when retries become due. Even an unchanged initial
revision may accompany unfinished integration work. Revision messages are never
work claims or delivery acknowledgements; private worker claim/acknowledgement
contracts remain separate.

The stream follows the explicit hunt ID, not changes to a guild's active-hunt
selection. A guild-wide selection feed or multi-hunt multiplexing is outside
this first protocol.

Use `client.watchModel(model, { onError })` to opt into notifications and safety
refreshes, or `client.watch(scope, { onRevision, onError })` for raw hints.
Both return `{ close, reconnect, done }`. Call `close()` on disposal/scope change;
after renewing credentials, `reconnect()` resumes a 401-paused subscription.
Terminal scope/protocol failures complete `done`; starting a new subscription
is explicit. These observations never call `retryPending()`.

Reference: [standard SSE framing](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events).

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
generation. This method belongs to `PostgresHuntIntegrationStore`, not the
user-facing `PostgresPuzzlehuntStore`. Its worker-only `submitIntegration` shares
the same transactional command implementation, preserving locking, receipts,
notifications, and durable integration work even when workers use a separate
store instance or process. A newer mutation leaves its pending job intact.
An intervening association write also advances the revision and schedules another pass; only
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

# Puzzlehunt model architectural decisions

This is a reviewable record for the opt-in prototype, not authorization to switch
existing Fluid consumers. Entries distinguish user-confirmed direction from
implementation choices made here. Tooling and production authentication remain open.

## 1. Keep the domain and its adapters in the model package

**Status:** Implemented in checkpoint `e0a3be2`; package layout is an implementation choice.

The model package owns domain commands, snapshots, projections, the PostgreSQL
adapter, its schema, and its tests. Use separate `document` and server-only
`postgres` entry points, rather than another workspace package or a dependency on
the bot. The schema is an exported SQL asset; applying it is explicit.

The PostgreSQL adapter still accepts an injected connection pool. Moving it
changes no transaction, receipt, outbox, or graph-validation behavior. Existing
Fluid exports and consumers remain unchanged. PGlite tests move with the adapter;
they exercise SQL constraints but do not prove multi-connection locking.

**Reason:** Code ownership should follow responsibilities, not the first process
chosen to host them. Keeping one package and explicit entry points is the smallest
separation; browser-facing entries must not import PostgreSQL or platform clients.

## 2. Separate optimistic visibility from authoritative commitment

**Status:** User-confirmed direction; implemented after the checkpoint.

Preserve a familiar synchronous local mutation API where useful. A facade tracks
committed state and pending semantic commands, exposes their projected effects,
and provides explicit asynchronous settlement and failures. It never sends a
replacement document. Server write order and server timestamps remain authoritative.

Use the existing `HuntDocumentClient` boundary rather than inventing another
command/transport interface. The bot and website can both use an HTTP adapter;
a local adapter is also useful for tests and initial cohosting.

Pending-command rejection, rebasing, and acknowledgement handling must be tested.
Do not add a disconnected-edit protocol or duplicate the domain rules in a UI.

The `model` entry point now exports `IPuzzlehuntModel`, plain read-only views, and
the optimistic `PuzzlehuntModel`. Familiar methods delegate to the existing
command reducer. The `fluid` entry point adds `FluidPuzzlehuntModel`, a small
adapter over the existing `IPuzzlehunt`; it does not reimplement Fluid persistence.
The legacy package root remains compatible.

## 3. External integrations consume durable server intent

**Status:** User-confirmed direction; worker implementation remains deferred.

The bot handles interactions and relevant Discord gateway events. Application
service workers perform Discord/Google reconciliation through external APIs.
Workers consume transactionally recorded events/jobs and current desired state,
not optimistic facade notifications or Fluid `TreeView` diffs.

Initially these responsibilities may share a process. Neither package ownership
nor the model API should require that. Creation journals, leases, retry recovery,
and external-effect repair are still prerequisites for enabling workers.

## 4. Test the model contract independently of representation

**Status:** Implemented and exercised against both local services.

Use one behavioral suite with backend fixtures, not duplicated Fluid and SQL
assertions. Fixtures own service setup, isolation, synchronization, and disposal.
The existing Fluid implementation runs against the local ordering service; the
PostgreSQL implementation runs against a disposable local PostgreSQL database.
Retain backend-specific SQL and Fluid delta tests where they test representation.

The shared suite covers existing common behavior. The user-confirmed new-path
solve/status/logging changes remain explicitly PostgreSQL-specific; a fixture
must not silently compensate for or change legacy Fluid behavior.

The single contract suite is `src/test/model/contract.ts`; the backend test files
only provide fixtures. Coverage includes immediate local visibility, persisted
reload identity, depth-first/sibling ordering, nested moves/deletion, properties,
solve/unsolve, statuses, subscriptions, concurrent additions and independent
assignments, and later service-ordered solves.

Additional real PostgreSQL tests force simultaneous row-lock waits, race cyclic
moves, read during an uncommitted metadata/node write, and retry a lost solve
acknowledgement after a newer solve. They also verify that database time replaces
a deliberately skewed optimistic status timestamp. PGlite remains the faster SQL-constraint suite,
not a substitute for these multi-connection tests.

## 5. Use one FIFO pipeline for commands and refreshes

**Status:** Implementation choice; rejection policy was explicitly confirmed by the user.

Only one command/read is in flight per optimistic `PuzzlehuntModel` instance.
Different models still submit concurrently; PostgreSQL determines authoritative
write order per hunt. The Fluid adapter retains Fluid's own ordering protocol.
Batch creation remains one command. Acknowledgements retire their command before
remaining commands are projected over the returned snapshot.

Refresh requests enter that same pipeline. This deliberately avoids a more complex
protocol for determining which pending commands are already reflected in an
independently fetched snapshot. An invalidation queues a refresh rather than
installing arbitrary snapshots directly. Older revisions and mismatched scopes
cannot replace current state.

Definitive `HuntCommandError` rejections roll back the edit. Reprojecting from
authoritative state explicitly fails queued edits that no longer apply, while
independent edits proceed. Failures remain inspectable until `clearFailures()`.
A non-domain failure has an uncertain commit result: retain the original command
ID/payload, pause the queue, expose the error, and resume through `retryPending()`.
Do not silently regenerate IDs, discard unknown outcomes, or automatically retry
forever. HTTP adapters will need to translate explicit server rejections into the
domain error contract; their authentication/error protocol is still deferred.

**Trade-off:** A slow/uncertain write also delays this model's refreshes. This is
the simpler initial protocol, not a fully disconnected editor. `flush()` confirms
the current drain/batch, not one selected command; call it immediately after an
action that needs confirmation. It rejects if that batch fails or pauses. Earlier
failures stay visible even when a later batch succeeds.

## 6. Expose stable IDs and plain views, not tree-specific diffs

**Status:** Implementation choice consistent with the confirmed model direction.

The common interface retains familiar model operations and round child lists, but
IDs are strings and notifications are parameterless invalidations. Read fresh
values after notification; returned views are immutable values, not live handles.
Both backends use the same parent-pointer view projection and depth-first ordering.

The Fluid adapter uses SharedTree's existing stable-ID conversion, rather than a
new identity map or exposing session-local compressed numeric IDs. Tree access is
isolated to that adapter. It preserves legacy solve/status semantics and client
timestamps. An additive typed `unsolve` method removes the answer trait; existing
callers have not been switched. Worker-only Discord association writes are not
part of the ordinary model interface.

`flush()` on Fluid waits for service acknowledgement; remote readers still receive
changes asynchronously. Its `refresh()` flushes local changes because remote
updates are already streamed. Fixtures wait for actual convergence rather than
assuming every observer has processed an acknowledged change.

## 7. Own disposable services in the tests

**Status:** Implementation choice; verified on this Windows worktree.

Use the existing Azure local service (Tinylicious) for Fluid ordering, and
test-only `embedded-postgres` plus `pg` for a real PostgreSQL service. No global
PostgreSQL/Docker installation, external database URL, production driver bootstrap,
or Azure resource is required. Each database fixture owns a temporary cluster,
binds to loopback, resets hunt tables before each test, and shuts down afterward.
Native PostgreSQL is only a development dependency; this does not select an ORM
or production database version. On Unix, run as a non-root user; the fixture does
not create host accounts. Automatic dependency-symlink rehydration avoids requiring
installer scripts for the native test binaries.

The model's test runner owns a local ordering-service child process, dynamic port,
temporary storage/log directory, readiness check, and shutdown. It launches Node
directly rather than the old Windows process-tree helper, which requires the
removed `wmic.exe`. Legacy tests accept the runner's endpoint through an environment
variable, retaining their previous localhost default. Vitest explicitly includes
source tests only, preventing a build's emitted tests from running again.

A test-only declaration re-exports `embedded-postgres`' own types for the repository's
legacy TypeScript Node resolver. It avoids duplicating its API or changing every
package's module-resolution strategy.

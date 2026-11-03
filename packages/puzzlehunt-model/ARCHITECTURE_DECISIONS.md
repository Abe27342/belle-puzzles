# Puzzlehunt model architectural decisions

This is a reviewable record for the opt-in prototype, not authorization to switch
existing Fluid consumers. Entries distinguish user-confirmed direction from
implementation choices made here. Tooling and deployment remain open; the initial
HTTP authorization policy is recorded below.

## 1. Keep the domain and its adapters in the model package

**Status:** Implemented in checkpoint `e0a3be2`; package layout is an implementation choice.

The model package owns domain commands, snapshots, projections, the PostgreSQL
adapter, its schema, and its tests. Use separate `document` and server-only
`postgres` entry points, rather than another domain/store workspace package or a
dependency on the bot. The schema is an exported SQL asset; applying it is explicit.

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
forever. The HTTP adapter now translates matching explicit server rejections into
the domain error contract, including authorization failures. Malformed responses
and 5xx responses never count as proof of rejection.

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

Vitest's `globalSetup` owns a local ordering-service child process, dynamic port,
temporary storage/log directory, readiness check, and returned teardown. Tests use
Vitest's typed `provide`/`inject` endpoint; the package runs `vitest run` directly.
An optional `PUZZLEHUNT_FLUID_ENDPOINT` selects an already running service, which
the suite does not stop or reset. The owned service launches Node directly:
`start-server-and-test@1.15.5` used `ps-tree@1.2.0`, whose Windows cleanup spawns
`wmic.exe`. That executable is absent on this host but may exist on other Windows
installations. No operating-system fix or PostgreSQL setting was involved.
Vitest explicitly includes source tests only, preventing a build's emitted tests
from running again.

A test-only declaration re-exports `embedded-postgres`' own types for the repository's
legacy TypeScript Node resolver. It avoids duplicating its API or changing every
package's module-resolution strategy.

## 8. Add an HTTP transport and an independently hosted application service

**Status:** Implemented; guild-member access and a separate trusted-bot credential
were explicitly confirmed by the user. Package layout and wire details are
implementation choices.

The model's browser-safe `http` entry point implements `HuntDocumentClient`.
`PuzzlehuntModel` remains the only optimistic command facade; HTTP introduces no
second domain implementation. Tokens are obtained per request. There are no
automatic retries, cookies, redirect following, or change subscriptions.

`packages/puzzlehunt-service` owns the Express host, production PostgreSQL pool,
Discord authorization, startup configuration, and shutdown. It depends on the
existing model/store entry points, never the Discord gateway bot. This separate
executable can run in a Container App without making the bot a required host.
Existing bot/site Fluid paths are not switched.

Any current Discord guild member may read and edit that guild's hunts through an
OAuth token with the existing `guilds` scope. Trusted-bot requests use a separate
service credential and `Service` authorization scheme, distinct from OAuth
`Bearer` tokens so invalid service keys are never forwarded to Discord. The
service checks the configured bot's guild access with
Discord rather than trusting a client-supplied guild assertion. The URL scopes
authorization, and the database independently checks hunt ownership. Public JSON
cannot change ownership/configuration or invoke worker-only commands.

Expose active selection at `/guilds/:guildId/hunts/active`, returning a snapshot,
instead of changing the old Fluid-context endpoint. Snapshot reads and command
submissions have scoped GET/POST routes. JSON decoding and a 1 MiB request limit
sit before the typed store. Commands return only after commit.

Only recognized JSON rejection envelopes with matching 4xx statuses are
definitive. Authentication/authorization failures join the existing
`HuntCommandError` contract, so rollback/rebasing needs no HTTP-specific model
branch. Network failures, timeouts, invalid snapshots/receipts, and all 5xx
responses retain the pending command and its original ID, because commit status
can be unknown. Unexpected server errors are logged, not returned verbatim.

## 9. Preserve a local application test seam without adding that suite yet

**Status:** User-confirmed priority; application tests explicitly deferred by the user.

The executable composes the exported `createPuzzlehuntApp` factory with a real
store and Discord authorizer. The factory has no environment, listen, or database
startup side effects. A future test host can inject a disposable local PostgreSQL
pool through the store and substitute the authorizer, then use an ephemeral
loopback HTTP port with the real client. No production authentication bypass or
automatic database reset is introduced. The shared PostgreSQL fixture resolves
the schema's package export, so source and compiled test hosts use the same asset.

Discord membership checks require network access in production. Substituting
that boundary is necessary for deterministic, fully local application tests;
there is no other known architectural obstacle. The existing model/service
contract suite remains unchanged. New tests cover the protocol, transport, and
authorization/configuration functions, not a local HTTP-plus-database application
suite. Notifications/reconnection, external workers, consumer cutover, provisioning,
and deployment remain separate follow-up work.

## 10. Simplify commands and share the core model interface

**Status:** Implemented from user review feedback.

Use only `add`, `delete`, `move`, and `set-property` commands. A mapped union ties
each known property name to its value type; nullable properties use explicit
`null` to clear. Public properties are `name`, `url`, `answer`, `status`, and
`sheetId`. Worker-only `discord` assignments use the same shape but remain a
separate command type, not part of the public HTTP allowlist. Answer/status
assignments retain their domain side effects and distinct integration events;
this is not unrestricted object patching.

The shared generic `IPuzzlehunt` defines common reads and mutations once. The
legacy interface specializes it for Fluid handles/numeric IDs and adds existing
metadata, Discord association, and tree event APIs. `IPuzzlehuntModel` specializes
it for stable IDs/plain views and adds subscriptions and asynchronous settlement.
The earlier duplicated signatures were a compatibility shortcut, not a required
architectural boundary. Existing Fluid implementations and consumers keep their
behavior.

Both projections build and sort a parent-to-children index once, rather than
scanning every node for each round. `validateHuntDocument` names the existing
graph validation explicitly.

## 11. Use Zod at the REST boundary

**Status:** Implemented from user review feedback; no ORM selection implied.

Shared Zod schemas validate public requests and response snapshots/receipts.
Strict request objects reject unknown and privileged fields; response objects
allow unrelated additional fields for compatibility. Graph validation and
request-specific scope/receipt matching remain semantic checks.

Malformed requests become definitive `invalid-command` rejections. Malformed
responses, including invalid graph invariants, remain `HuntProtocolError` with
the validation cause, never a definitive rejection of a possibly committed edit.
Readable domain interfaces remain independent of Zod, with schema output types
checked against them. Explicit nullable schema types preserve required fields
for the legacy non-strict TypeScript build without weakening runtime validation.

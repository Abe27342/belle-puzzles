# Puzzlehunt model architectural decisions

This is a reviewable record for the opt-in prototype, not authorization to switch
existing Fluid consumers. Entries distinguish user-confirmed direction from
implementation choices made here. Tooling and production authentication remain open.

## 1. Keep the domain and its adapters in the model package

**Status:** Implemented checkpoint; package layout is an implementation choice.

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

**Status:** User-confirmed direction; facade implementation follows the checkpoint.

Preserve a familiar synchronous local mutation API where useful. A facade tracks
committed state and pending semantic commands, exposes their projected effects,
and provides explicit asynchronous settlement and failures. It never sends a
replacement document. Server write order and server timestamps remain authoritative.

Use the existing `HuntDocumentClient` boundary rather than inventing another
command/transport interface. The bot and website can both use an HTTP adapter;
a local adapter is also useful for tests and initial cohosting.

Pending-command rejection, rebasing, and acknowledgement handling must be tested.
Do not add a disconnected-edit protocol or duplicate the domain rules in a UI.

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

**Status:** User-requested; local-service suite follows the checkpoint.

Use one behavioral suite with backend fixtures, not duplicated Fluid and SQL
assertions. Fixtures own service setup, isolation, synchronization, and disposal.
The existing Fluid implementation runs against the local ordering service; the
PostgreSQL implementation runs against a disposable local PostgreSQL database.
Retain backend-specific SQL and Fluid delta tests where they test representation.

The shared suite covers existing common behavior. The user-confirmed new-path
solve/status/logging changes remain explicitly PostgreSQL-specific; a fixture
must not silently compensate for or change legacy Fluid behavior.

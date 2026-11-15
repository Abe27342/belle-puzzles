# @belle-puzzles/puzzlehunt-model

This package hosts the document model for a puzzlehunt.

Two implementations are available:

-   An implementation backed by Fluid's experimental SharedTree, generally available via `@belle-puzzles/puzzlehunt-model/fluid`
-   An implementation backed by postgres, generally available via `@belle-puzzles/puzzlehunt-model/postgres`

The latter is currently a work in progress, as there were some leaky Fluid abstractions.
The Fluid backed implementation is in the process of being retired, as Azure Fluid Relay is being sunsetted and this project's actual technical requirements do not particularly warrant using Fluid if that additionally involves the burden of running an ordering service.
See [this Github issue](https://github.com/Abe27342/belle-puzzles/issues/44) for status and relevant details.

## Model change events

The common `IPuzzlehunt` contract exposes `subscribeChanges(listener)`, returning an unsubscribe function.
Each `PuzzlehuntChangeEvent` contains historical, read-only `before` and `after` views and a batch of `node-added`, `node-removed`, or `node-changed` values.
These are plain `DocumentNode` values with stable string IDs, including parent/position and association properties; a changed node includes its full old and new values.
Derived round children are available in the event views, and whole added/removed subtrees include every domain node.
Fluid's raw tree deltas and handles remain internal to event production.

Events describe observed visible state, including local optimistic edits, remote edits, and rollback/rebase corrections.
Unchanged acknowledgements and no-op edits do not emit another change event.
`IPuzzlehuntModel.subscribe()` remains the broader UI invalidation mechanism, including pending/error-only state changes.
Notifications are not durable or exactly-once integration work: PostgreSQL provisioning remains driven by persisted work items rather than speculative client events.

## Testing

Models are tested using contract-based tests running against local databases/services.
This means using azure-local-server for the Fluid backed implementation, and a disposable native PostgreSQL service for the postgres model implementation.

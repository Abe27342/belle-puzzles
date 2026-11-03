# @belle-puzzles/puzzlehunt-model

This package hosts the document model for a puzzlehunt.

## Read-only snapshots

`snapshotPuzzlehunt(hunt)` synchronously materializes the current tree view and
guild settings as plain JSON-compatible data, including stable SharedTree node
IDs, ordered relationships, and present optional fields. It does not copy into
another document or retain editing history.

`loadExistingPuzzlehunt(client, id, { signal, catchUp })` optionally accepts
cancellation and an additional asynchronous catch-up fence before constructing
the model. Failed/cancelled loads dispose the container. Callers must still dispose
successful loads. The legacy Fluid catch-up helper alone does not guarantee
storage prefetch is complete for read connections without server checkpoints;
the [standalone exporter](../bot/README.md#exporting-puzzlehunt-data) supplies a
delta-storage fence for those connections.

## Testing

Tests for this package rely on azure-local-server.
It would be nice to support in-process testing (i.e. if Fluid's local driver or equivalent worked with AFR).

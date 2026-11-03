# @belle-puzzles/puzzlehunt-model

This package hosts the document model for a puzzlehunt.

## Database-backed foundation

The opt-in `@belle-puzzles/puzzlehunt-model/document` entry point provides
Fluid-independent snapshots, semantic commands, and view projections.
See [the initial database model](DATABASE_MODEL.md) for the PostgreSQL
representation, concurrency/retry semantics, durable integration work, and
the proposed API and view-layer contracts. Existing Fluid consumers are unchanged.

## Testing

The existing Fluid tests for this package rely on azure-local-server.
It would be nice to support in-process testing (i.e. if Fluid's local driver or equivalent worked with AFR).

The database document unit tests need no Fluid service:
`pnpm --filter @belle-puzzles/puzzlehunt-model exec vitest run document.spec.ts`.

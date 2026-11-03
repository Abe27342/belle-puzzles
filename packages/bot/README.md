# Belle Bot

## Opt-in database foundation

`src/database/schema.sql` and `PostgresPuzzlehuntStore` provide the initial
PostgreSQL persistence path, without opening connections or switching existing
commands at startup. See the [database model specification](../puzzlehunt-model/DATABASE_MODEL.md)
for the transaction protocol, required integration worker work, and cutover boundaries.
The schema is not automatically applied.

The store tests use ephemeral in-memory PostgreSQL through PGlite, not a live service:
build the model with `pnpm --filter @belle-puzzles/puzzlehunt-model build`, then run
`pnpm --filter @belle-puzzles/bot exec vitest run puzzlehuntStore.spec.ts`.

TODO: Better telemetry story.
TODO: Show error messages in a channel for the server?

TODO: Make sense of layering in this package. Right now it's set up to use a project build with tsc because
without it build times are ~3x slower due to large number of file imports from google APIs. But there are
probably more gains to be had in the realm with more sensible layering and package structure.

TODO: consider using [forever](https://www.npmjs.com/package/forever)

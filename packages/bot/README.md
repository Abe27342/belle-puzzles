# Belle Bot

TODO: Better telemetry story.
TODO: Show error messages in a channel for the server?

TODO: Make sense of layering in this package. Right now it's set up to use a project build with tsc because
without it build times are ~3x slower due to large number of file imports from google APIs. But there are
probably more gains to be had in the realm with more sensible layering and package structure.

TODO: consider using [forever](https://www.npmjs.com/package/forever)

## Exporting puzzlehunt data

The standalone proof-of-concept exporter inventories **every Discord guild the
configured Belle bot belongs to**, including guilds without a hunt. It ignores
`GUILD_ALLOW_LIST` and `GUILD_BLOCK_LIST`. It does not start the bot, register
commands, attach integration/synchronization listeners, create channels or sheets,
post messages, change pins, or edit hunt documents. Fluid connections use
document-read-only tokens (no document-write or summary-write scope).

Use the existing Node/pnpm versions from the root `package.json`. From the
repository root:

```powershell
pnpm install --frozen-lockfile
pnpm --filter @belle-puzzles/puzzlehunt-model --filter @belle-puzzles/bot run build
New-Item -ItemType Directory -Force .\exports | Out-Null
pnpm export:hunts --output .\exports\migration-2026-11-02
```

The output directory must **not already exist**; its parent must exist. Paths are
relative to the invoking working directory. Use a new directory for every attempt,
including retries of incomplete runs. The root `exports` directory is Git-ignored;
for other locations, choose a path outside the checkout. Exports contain private
hunt data and answers: restrict filesystem access and do not commit or publish
them. Files/directories request owner-only permissions where supported; on Windows,
use appropriate ACLs for the parent directory.

Set `CLIENT_ID` and `DISCORD_TOKEN` for the actual Belle bot, plus
`FLUID_TENANT_ID` and `FLUID_PRIMARY_KEY`, through the environment or the
Git-ignored repository-root `.env` (see `.env.sample`). The token's authenticated
bot ID must match `CLIENT_ID`. No Google credentials are needed. Discord must
allow reading guild channels, viewing `belle-bot-admin`, and reading its pinned
messages/message history. Missing access, missing/redacted content, malformed
configuration, and ambiguous admin channels/pins are failures, not "no hunt."
Only the absence of a `belle-bot-admin` channel is classified as `no-hunt`.
The exporter paginates both guild membership and pinned messages and selects the
single Belle-authored pinned context, matching the bot's discovery convention.

`USE_LOCAL_SERVICE=1` selects the existing local Fluid service at
`http://localhost:7070` instead of Azure; it does **not** make Discord local.
Live exports require permission to access the configured bot's guild data.
`pnpm export:hunts --help` does not use credentials or contact either service.
Document loading/catch-up has a two-minute deadline; override with
`--timeout-ms 300000` when necessary. A timed-out guild is recorded as failed,
and enumeration continues. This is a read-only extraction tool, not a cutover,
backup of history, or importer.

### Output contract (schema version 1)

`manifest.json` identifies the format/version, unique export ID, source bot and
Fluid endpoint/tenant, timestamps, guild outcomes and counts, discovery failures,
and `complete`. It is written with `complete: false` before remote access and
updated atomically as guilds are processed. Each guild is `exported`, `no-hunt`,
or `failed`; failures include their stage and diagnostic. Successful guilds point
to `<guildId>.json`. Failed document loads retain the discovered pinned
configuration in the manifest. An interrupted run remains incomplete; unreferenced
or partially written files must not be imported.

Each guild file contains:

-   `source`: Discord guild ID/name, admin channel/message/author IDs, pin/edit
    timestamps and exact pinned content, Fluid document ID/endpoint/tenant and
    compatible SharedTree model/write format.
-   `metadata`: the parsed pinned configuration, including `name`, `fluidFileId`,
    `googleFolderId`, `indexId`, `allPuzzlesRoleId`, and any additional JSON fields.
    Older contexts may omit the last three fields; absence is preserved.
-   `state`: the document's guild ID, optional logging channel configuration,
    ordered `rootIds`, and a flat preorder `nodes` array. Nodes include type,
    name/URL, optional parent ID, all present Discord channel/role/index
    associations (including partially populated associations), ordered round
    `childIds`, and puzzle sheet ID, answer, status and `lastStatusUpdate`.
    Absent fields are omitted, not converted to empty strings or null; present
    empty strings and timestamp zero are retained.

Node and relationship IDs are **stable SharedTree IDs**, obtained through the
compatible tree's ID converter, never raw session-local Fluid `NodeId` values.
Treat `(source.fluid.documentId, node.id)` as the source identity when assigning
destination database IDs. Copying a hunt to another document is not a guarantee
of shared node identity.

The exporter uses the existing Fluid schema/client, reads an operation
high-watermark from delta storage, and waits for the container to process through
that fence, including unsummarized operations. This extra fence is necessary
because the old Fluid catch-up helper can return early on read connections
without a server checkpoint. It then synchronously materializes one immutable
tree view and the guild settings. The pinned message is reread
afterward; a changed/deleted/unpinned context fails that guild. Each document is
consistent at its own capture time; this is **not** a global transaction across
Discord and all guild documents. Concurrent edits or guild membership changes
after capture are not included. Coordinate a quiet period and rerun before a
future cutover.

Exit code `0` means guild enumeration finished and all discovered guilds were
either exported or confirmed without a hunt. Exit code `1` means incomplete or
failed execution. Always require `manifest.complete === true` before treating a
run as complete; do not infer success from the existence of files or zero failed
guilds when guild enumeration itself failed.

### Exporter validation

From `packages/bot`, run:

```powershell
pnpm test:run src/test/export.spec.ts
```

For the local Fluid checks, start `pnpm start:localserver` in a separate terminal,
then run the following and stop the relay afterward:

```powershell
pnpm test:run src/test/export.spec.ts src/test/export-fluid.spec.ts
```

The first command uses fake Discord reads and temporary filesystem output only.
The Fluid checks use a local relay to verify catch-up of newly saved,
unsummarized operations, stable identities across fresh loads, logical fields and
ordering, and absence of source edits. Neither contacts live Discord or Azure.

# Belle Bot

TODO: Better telemetry story.
TODO: Show error messages in a channel for the server?

TODO: Make sense of layering in this package. Right now it's set up to use a project build with tsc because
without it build times are ~3x slower due to large number of file imports from google APIs. But there are
probably more gains to be had in the realm with more sensible layering and package structure.

TODO: consider using [forever](https://www.npmjs.com/package/forever)

## Local PostgreSQL bot opt-in

Fluid remains the default. `DATABASE_URL` alone does not select PostgreSQL. Opt in
only a local test bot/guild with these **server-only** environment settings
(the root `.env` is ignored):

```dotenv
LOCAL_POSTGRES_GUILD_IDS=123456789012345678
GUILD_ALLOW_LIST=123456789012345678
DATABASE_URL=postgresql://local_user:local_password@127.0.0.1:5432/local_hunts
PUZZLEHUNT_SERVICE_BASE_URL=http://127.0.0.1:3001
PUZZLEHUNT_SERVICE_TOKEN=<at-least-32-non-whitespace-characters>
CLIENT_ID=<local-discord-application-id>
VITE_BELLE_BOT_CLIENT_ID=<same-local-discord-application-id>
DISCORD_TOKEN=<local-test-bot-token>
```

`LOCAL_POSTGRES_GUILD_IDS` has no default; when present it must be a nonempty
comma-separated list of Discord IDs. Every entry must appear in an explicit
`GUILD_ALLOW_LIST` and none may appear in `GUILD_BLOCK_LIST`. Other allowed guilds
remain Fluid. The service URL and database URL are required, must use `localhost`,
`127.0.0.1`, or `[::1]`, and cannot have query overrides or fragments. The service
URL cannot contain credentials. Never expose `PUZZLEHUNT_SERVICE_TOKEN` or
`DATABASE_URL` to the browser. The service and browser use
`VITE_BELLE_BOT_CLIENT_ID`, which must identify the same application as bot
`CLIENT_ID`.

Run the existing puzzlehunt-service initializer and HTTP service separately.
Use a loopback service `HOST` and a distinct service `PORT` (normally 3001); bot
`PORT` defaults to 3000 and the opted-in metadata server binds to `127.0.0.1`.
Keep per-process port overrides separate rather than sharing a single `PORT` in
the root environment. Register commands on the test guild using the existing
`update-commands` script and local bot credentials; `/retry_pending` and
`/resync_all` are test-server-only.

### Creating a hunt

Run `/create name folder_link` with a Google Drive folder's sharing link. Wait for
the creation-success reply before adding rounds or puzzles. An existing admin
channel or configured/nonempty hunt prevents replacement.

The existing initializer creates an **empty, unconfigured active seed hunt**.
One untouched seed may precede an explicit `/create`; the requested new hunt
becomes active and the empty seed stays as the only prior hunt. Nothing deletes
or adopts it. Modified empty hunts or multiple prior hunts also prevent replacement.
Inspect the database and Discord resources after any partial or uncertain create;
do not blindly rerun it. There is no setup-resume or adoption command.

Existing Fluid hunts remain Fluid even in opted-in guilds. Disabling PostgreSQL
for an existing PostgreSQL hunt reports an error, rather than opening it as Fluid
or creating a replacement.

### Saved changes and recovery

A successful edit means the hunt document was saved; Discord channels, Sheets,
and logs may still be pending. `/resync_all`, or the existing `/sync_all`, requests
a reconciliation pass from the admin channel. Check bot diagnostics if work
remains pending or repeatedly fails. External resource operations retry
automatically; a lost response may leave duplicate resources or messages requiring
manual cleanup. Unconfigured seeds do not provision resources and report a
missing-configuration diagnostic.

If a write's outcome is uncertain, do not repeat the original mutation. Follow the
error's `/retry_pending hunt_id:<exact-uuid>` instruction from the unique
`belle-bot-admin` channel while the same bot process is running. This does **not**
resume hunt setup or control external integration retries. After a process exit,
inspect authoritative state and recorded error/command IDs before taking further action.

Fluid copy/change-backing-file commands reject PostgreSQL. `/reset_server` rejects
opted-in guilds and existing PostgreSQL backend pins even when the backend is disabled.

Use SIGINT/SIGTERM for graceful shutdown and wait for the bot to exit. If shutdown
reports a failure, inspect its retained-write diagnostics before restarting; it
does not automatically retry uncertain writes.

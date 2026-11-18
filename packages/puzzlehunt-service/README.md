# Puzzlehunt application service

The puzzlehunt application service is an HTTP API for puzzlehunt documents stored
in PostgreSQL. It provides guild-scoped reads, transactional editing commands,
and server-sent events (SSE) that notify clients when a hunt's revision changes.
Discord supplies user identity and guild membership for authorization.

## Running

Use Node 20.15 or newer, pnpm, and a running PostgreSQL server. The database setup
commands below use PostgreSQL's `createdb` and `psql` tools.

From the repository root, install dependencies, build the service, and create
your local configuration. If `.env` already exists, merge the example's settings
into it instead of running `Copy-Item`:

```powershell
pnpm install
pnpm build:puzzlehunt-service
Copy-Item packages\puzzlehunt-service\.example.env .env
```

Edit `.env` to set `DATABASE_URL` to your database's connection URL.
The service and initializer both load this file; environment variables supplied
by the host take precedence. Shared website defaults are then loaded from
`packages/site/.env`, reusing its `VITE_BELLE_BOT_CLIENT_ID` rather than duplicating
the Discord application ID.

### Set up a new database

Create an empty database, then initialize it for your Discord guild. Replace the
guild ID and hunt name below with your own:

```powershell
createdb --host=127.0.0.1 --username=postgres belle_puzzles
pnpm init:puzzlehunt-service 123456789012345678 "My puzzlehunt"
```

The initializer uses `DATABASE_URL` from `.env`. It applies
`packages/puzzlehunt-model/src/postgres/schema.sql`, creates an empty hunt, and
selects it as the guild's active hunt in one transaction. It prints the new hunt
ID. Run it once per fresh database; an already initialized database is rejected
without changing its data.

### Use an existing database

Set `DATABASE_URL` in `.env` to an existing puzzlehunt database, retaining its
hunts and active-hunt selections. To load a plain SQL backup into a fresh database:

```powershell
createdb --host=127.0.0.1 --username=postgres belle_puzzles
psql --host=127.0.0.1 --username=postgres --dbname=belle_puzzles --single-transaction --set=ON_ERROR_STOP=1 --file=backup.sql
```

Point `.env` at the restored database. Schema and data come from the backup, so
skip the initializer.

### Start the service

For either database setup:

```powershell
pnpm start:puzzlehunt-service
```

The example configuration listens on `http://127.0.0.1:3001`. An authenticated
`GET /guilds/:guildId/hunts/active` retrieves the selected hunt and its ID.

### Configuration

| Environment variable         | Purpose                                                                                                                                            |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`               | Required PostgreSQL connection URL. Configure verified TLS for remote databases through the connection settings.                                   |
| `VITE_BELLE_BOT_CLIENT_ID`   | Expected Discord OAuth application ID, shared with the website's `packages/site/.env`. Host/root `.env` settings can override the shared default.  |
| `HOST`                       | Listen address; defaults to `0.0.0.0` for container hosting. Use `127.0.0.1` for local-only access.                                                |
| `PORT`                       | Listen port; defaults to `3001`. `0` allows a host-assigned local port.                                                                            |
| `PUZZLEHUNT_ALLOWED_ORIGINS` | Comma-separated browser origins. Browser requests must match an allowed origin; authentication uses explicit headers.                              |
| `PUZZLEHUNT_SERVICE_TOKEN`   | Optional separate trusted-bot credential, at least 32 non-whitespace characters. Keep this server-side; never include it in website configuration. |
| `DISCORD_TOKEN`              | Discord bot token, required only when trusted-service access is enabled. Used to verify the bot belongs to the requested guild.                    |

Keep local secrets in the root `.env` (ignored by Git); use the hosting environment
for deployed secrets. Terminate public HTTPS at the container ingress/reverse
proxy. The service uses a five-connection PostgreSQL pool plus one dedicated,
session-affine LISTEN connection for revision hints. Use a direct or session-pooled
connection URL. It checks database/schema availability before listening, and
closes change streams before draining HTTP requests and closing the database
connections on shutdown.
`GET /liveness` checks that the HTTP process is responding.

## Hosting with the Discord bot

The service supports standalone hosting and co-hosting with the Discord bot in
one container app instance. Separate processes or containers can share that
instance using distinct listen ports: the bot defaults to `3000` and this service
to `3001`. If setting `PORT`, scope it to each process/container rather than giving
both listeners the same value. Ingress or a reverse proxy routes public requests
to the appropriate listener.

A combined Node host can instead mount `createPuzzlehuntApp` as an Express
sub-application under a dedicated path on a shared HTTP server. The
`@belle-puzzles/puzzlehunt-service/app` entry point exports the app factory,
`createDiscordHuntAuthorizer`, and `PostgresHuntChangeFeed`. The host supplies the
store, authorizer, change feed, and allowed origins, and owns listening and
shutdown. This keeps domain and authorization behavior consistent across either
hosting arrangement.

## API and authorization

Document requests use one of two explicit authorization schemes:

-   `Authorization: Bearer <token>` carries a person's Discord OAuth access token,
    which must be issued for Belle's configured application and have the existing `guilds` scope.
    Any current guild member may read and edit that guild's hunts. Guild membership
    is checked with Discord on each request, including pagination where necessary.
-   `Authorization: Service <token>` carries the optional trusted-bot credential,
    separate from the Discord bot token.
    It grants read/write access only to guilds the configured bot can access.
    Keep this credential exclusively in trusted server-side callers.

The service first calls Discord's `GET /api/v10/oauth2/@me` with the OAuth bearer
token and requires its `application.id` to match `VITE_BELLE_BOT_CLIENT_ID`.
Tokens issued for other applications are rejected before guild or hunt access.
It then calls `GET /api/v10/users/@me/guilds`, following pagination as needed.
Both checks run on each bearer-authenticated request. Discord identifies the
user from that credential and returns their guild memberships. Authorization
relies on Discord's membership records, rather than trusting a guild ID supplied
by the caller. The policy grants every current guild member read/write access;
individual Discord channel permissions and roles are not used to narrow that
access.

Authentication precedes document reads, JSON parsing, and commands. The store
independently requires the requested hunt to belong to the authorized guild.
Requests carry credentials in an explicit `Authorization` header over HTTPS;
browser clients omit cookies. CORS limits browser origins in addition to, rather
than instead of, these authorization checks.
Treat bearer tokens as secrets: possession grants the holder the user's access
until the token expires or is revoked.

| Route                                                  | Result                                                                           |
| ------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `GET /guilds/:guildId/hunts/active`                    | Current `HuntSnapshot` selected by `active_hunts`, or 404 if none is selected.   |
| `GET /guilds/:guildId/hunts/:huntId`                   | Scoped `HuntSnapshot`.                                                           |
| `POST /guilds/:guildId/hunts/:huntId/commands`         | `HuntCommandRequest` in, committed `HuntCommandResult` out.                      |
| `GET /guilds/:guildId/hunts/:huntId?since=R`           | Revision-relative `HuntStateUpdate`, with explicit full fallback.                |
| `POST /guilds/:guildId/hunts/:huntId/commands?since=R` | `{ receipt, replayed, update: HuntStateUpdate }`; unchanged command body.        |
| `GET /guilds/:guildId/hunts/:huntId/changes`           | Authorized SSE revision hints, including a current baseline on every connection. |

Commands require `application/json`, have a 1 MiB request limit, and reject
unknown properties and integration-only commands. Responses are uncached.
`update-configuration` accepts the common hunt configuration, including logging
channel mappings; omitted fields are unchanged. Root-round creation and root
moves omit `parentId` rather than sending `null`. Store-backed integration workers
use a separate completion capability.

Full snapshots keep `huntId`, `guildId`, `schemaVersion`, and `revision` outside
`document`; `document` contains `name`, `configuration`, and `nodes`. Incremental
updates retain flat `name`/`configuration` fields and assemble that same document
shape. For incremental command acknowledgements the route explicitly submits
once, then reads current state; a failed post-commit read is uncertainty, not a
rejected mutation.

Failures use `{ "error": { "code": "...", "message": "..." } }`.
Explicit 400/404/409 domain rejections and 401/403 authorization failures mean
the request did not commit. Wrong methods (405), oversized bodies (413), and
unsupported content (415) are also explicit rejections. Unexpected failures are
logged server-side and return a generic 500, without database or credential details.
A failed response does not imply a failed commit: retry uncertain writes with
their original command ID, never a new one.

## HTTP-backed model

The browser-safe HTTP adapter supplies the existing optimistic model's transport:

```ts
import { HttpHuntDocumentClient } from '@belle-puzzles/puzzlehunt-model/http';
import { PuzzlehuntModel } from '@belle-puzzles/puzzlehunt-model/model';

const client = new HttpHuntDocumentClient({
	baseUrl: 'http://localhost:3001',
	getToken: () => discordAccessToken,
});
const snapshot = await client.readActive(guildId);
const model = new PuzzlehuntModel(client, snapshot);

model.addRound('Round', 'https://example.test/round');
await model.flush();
await model.refresh();
```

Alternatively use `PuzzlehuntModel.load(client, { guildId, huntId })` when the
identity is already known. `getToken` may be asynchronous and is called for every
request, so the caller can supply a current OAuth token or server-side service
credential. Bot clients set `authScheme: 'Service'`; the default is `Bearer`.
Keeping these schemes distinct prevents invalid service keys from being forwarded
to Discord as OAuth tokens. Requests time out after 30 seconds by default
(`timeoutMs` overrides this), omit cookies, do not follow redirects, and do not
retry automatically.
`credentials: 'omit'` excludes ambient browser credentials, not the explicitly
supplied Authorization header.

The adapter validates snapshots and receipts before accepting them. Only a
recognized rejection envelope with a matching HTTP status becomes
`HuntCommandError`, allowing rollback. Network failures, timeouts, malformed
responses, and 5xx responses remain uncertain; the model keeps the original
command ID and exposes `retryPending()`.

Revision-relative reads and command acknowledgements transfer complete
affected-node records and deletions. The store retains 1000 revisions of
synchronization tracking per hunt; expired/missing history explicitly returns a
full snapshot.

The `/changes` endpoint sends an initial revision followed by revision hints.
Clients use those hints to request updates, with the durable PostgreSQL state as
the recovery source. Streams send 15-second heartbeats and rotate after 180
seconds; reconnecting requests recheck authorization. Membership revocation is
therefore checked on the next request or stream reconnection. Listener failure or
transport backpressure closes affected streams so clients can reconnect.
An unavailable listener returns 503 with `Retry-After: 30`.

## Testability

Run the focused service tests with:

```powershell
pnpm --filter @belle-puzzles/puzzlehunt-service test
```

The suites cover initialization, configuration, authorization, synchronization
routes, the LISTEN connection lifecycle, and the full shared model contract over
`PuzzlehuntModel` -> `HttpHuntDocumentClient` -> loopback HTTP service -> disposable
native PostgreSQL. Build the model dependency first, then run just this variant:

```powershell
pnpm --filter @belle-puzzles/puzzlehunt-service... build
pnpm --filter @belle-puzzles/puzzlehunt-service test src/test/model.spec.ts
```

The HTTP contract fixture seeds hunts directly, injects a deterministic local
authorizer, and synchronizes only the selected hunt by flushing and refreshing
its models. It does not start Fluid, call Discord, or require SSE observation.
The host closes its HTTP server, PostgreSQL change listener, and disposable
database after the suite.

`initializePuzzlehuntDatabase` applies
the schema and seeds an active hunt against a supplied pool, so local test
fixtures can use the same initialization as the command-line tool. Both the
initializer and its CLI entry point live in the package's `scripts/` directory.

`createPuzzlehuntApp` is the app used by the executable. Constructing it has no
environment or network side effects. Tests can supply a disposable store, a local
test authorizer, and an injectable change feed, then bind it to loopback on port
`0`. The test host owns database setup and shutdown. Production startup installs
the Discord authorizer.

## Code organization

`src/app.ts` composes request policy, CORS, the hunt router, and error handling.
`src/routes/hunts.ts` declares the routes and their named read handlers;
`src/routes/commands.ts` handles command submission, and
`src/routes/changes.ts` manages SSE subscriptions. Shared async handling, method
rejections, and error responses live in `src/middleware.ts`. The PostgreSQL LISTEN
connection lifecycle is implemented separately in `src/changes.ts`.

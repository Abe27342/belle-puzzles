# Puzzlehunt application service

This is the opt-in PostgreSQL HTTP host, separate from the Discord gateway bot.
It uses the existing model commands and transactional store; it does not switch
the current website/bot from Fluid or execute Discord/Google integration jobs.

## Running

Use Node 20.15 or newer. Create an empty local PostgreSQL database and apply
`packages/puzzlehunt-model/src/postgres/schema.sql` explicitly using `psql` or
another SQL tool. The service never
creates, migrates, seeds, or clears databases. Hunt import/provisioning and active
hunt selection are still separate work.

From the repository root, after installing dependencies:

```powershell
pnpm --filter @belle-puzzles/puzzlehunt-model build
pnpm --filter @belle-puzzles/puzzlehunt-service build
$env:DATABASE_URL = 'postgresql://<user>:<password>@localhost:5432/<database>'
$env:HOST = '127.0.0.1'
$env:PUZZLEHUNT_ALLOWED_ORIGINS = 'http://localhost:9000'
psql $env:DATABASE_URL --single-transaction -v ON_ERROR_STOP=1 -f .\packages\puzzlehunt-model\src\postgres\schema.sql
pnpm start:puzzlehunt-service
```

| Environment variable         | Purpose                                                                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`               | Required PostgreSQL connection URL. Configure verified TLS for remote databases through the connection settings.                                        |
| `HOST`                       | Listen address; defaults to `0.0.0.0` for container hosting. Use `127.0.0.1` for local-only access.                                                     |
| `PORT`                       | Defaults to `3001`, separate from the existing bot API. `0` allows a host-assigned local port.                                                          |
| `PUZZLEHUNT_ALLOWED_ORIGINS` | Comma-separated browser origins. Unset means no browser origins are allowed; non-browser requests are unaffected. No wildcard or cookie authentication. |
| `PUZZLEHUNT_SERVICE_TOKEN`   | Optional separate trusted-bot credential, at least 32 non-whitespace characters. Keep this server-side; never include it in website configuration.      |
| `DISCORD_TOKEN`              | Discord bot token, required only when trusted-service access is enabled. Used to verify the bot belongs to the requested guild.                         |

Supply secrets through the hosting environment, not source files. This entry point
reads the environment directly; it does not automatically load `.env` files.
Terminate public HTTPS at the container ingress/reverse proxy. The service uses
a five-connection PostgreSQL pool, checks database/schema availability before
listening, and drains HTTP requests before closing the pool on shutdown.
`GET /liveness` checks the HTTP process, not ongoing database or Discord health.
Azure provisioning and deployment configuration are not included.

## API and authorization

Document requests use one of two explicit authorization schemes:

-   `Authorization: Bearer <token>` carries a person's Discord OAuth access token,
    which must have the existing `guilds` scope.
    Any current guild member may read and edit that guild's hunts. Guild membership
    is checked with Discord on each request, including pagination where necessary.
-   `Authorization: Service <token>` carries the optional trusted-bot credential,
    separate from the Discord bot token.
    It grants read/write access only to guilds the configured bot can access.
    It is not a user impersonation or arbitrary cross-guild access mechanism.

Authentication precedes document reads, JSON parsing, and commands. The guild in
the URL is an authorization scope, and the store independently requires the hunt
to belong to that guild.

| Route                                          | Result                                                                         |
| ---------------------------------------------- | ------------------------------------------------------------------------------ |
| `GET /guilds/:guildId/hunts/active`            | Current `HuntSnapshot` selected by `active_hunts`, or 404 if none is selected. |
| `GET /guilds/:guildId/hunts/:huntId`           | Scoped `HuntSnapshot`.                                                         |
| `POST /guilds/:guildId/hunts/:huntId/commands` | `HuntCommandRequest` in, committed `HuntCommandResult` out.                    |

Commands require `application/json`, have a 1 MiB request limit, and reject
unknown properties and integration-only commands. No ownership, configuration,
active-hunt, or replacement-document writes are exposed. Responses are uncached.
The existing bot's `/guilds/:guildId/puzzlehunt` Fluid-context endpoint is unchanged.

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
```

Alternatively use `PuzzlehuntModel.load(client, { guildId, huntId })` when the
identity is already known. `getToken` may be asynchronous and is called for every
request, so the caller can supply a current OAuth token or server-side service
credential. Bot clients set `authScheme: 'Service'`; the default is `Bearer`.
Keeping these schemes distinct prevents invalid service keys from being forwarded
to Discord as OAuth tokens. Requests time out after 30 seconds by default (`timeoutMs` overrides
this), omit cookies, do not follow redirects, and do not retry automatically.

The adapter validates snapshots and receipts before accepting them. Only a
recognized rejection envelope with a matching HTTP status becomes
`HuntCommandError`, allowing rollback. Network failures, timeouts, malformed
responses, and 5xx responses remain uncertain; the model keeps the original
command ID and exposes `retryPending()`.

No automatic change notifications, polling, reconnect handling, or consumer
cutover is implemented. Use explicit `model.refresh()` to obtain other clients'
changes for now.

## Testability

`createPuzzlehuntApp` from `@belle-puzzles/puzzlehunt-service/app` is the same app
used by the executable. Importing it reads no environment, connects to nothing,
and does not listen. Its host supplies a store, an authorizer, and optional CORS
origins/error reporting.

A future local application fixture can construct `PostgresPuzzlehuntStore` with
its own disposable PostgreSQL pool, inject a test authorizer, bind this app to
loopback on port `0`, and point the real HTTP client at that port. The host owns
shutdown and database reset; the application never resets a supplied database.
Tests can therefore exercise the real HTTP/domain/SQL path without Discord or
Azure. Production startup always installs the Discord authorizer; there is no
environment-variable authentication bypass.

Discord authorization itself is an external dependency, so substituting the
authorizer is necessary for completely local, deterministic application tests.
There is no other known architectural blocker. Those application tests are
intentionally deferred at the user's request; focused protocol, HTTP transport,
authorization, and configuration tests exercise their individual boundaries.

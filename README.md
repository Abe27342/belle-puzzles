# Belle Puzzles

This repository hosts packages for the [Belle Puzzles bot and website](https://aka.ms/libracomplexity).

It uses [pnpm](https://pnpm.io/).

## Setup

1. Install [node 20](https://nodejs.org/en/download/) or later. I recommend using [nvm](https://github.com/nvm-sh/nvm) ([windows link](https://github.com/coreybutler/nvm-windows)) to manage node versions.
2. Enable corepack: `corepack enable`
3. Install repo dependencies: `pnpm i`
4. Build: `npm run build`

## Local PostgreSQL stack

Select **Local PostgreSQL stack** in VS Code's Run and Debug menu, or run
`pnpm start:local-postgres` from the root. This is an explicit **local-only opt-in**.
The existing Fluid targets and all production defaults remain unchanged; this
target does not start Tinylicious.

### One-time prerequisites

- Install dependencies (`pnpm install`), native PostgreSQL and Azure Functions
  Core Tools **v4**. SWA and Vite are already workspace dependencies. Use a Node
  version supported by your installed Core Tools, not merely the repository's
  minimum version. Docker is not required.
- Use a **dedicated Discord application and test guild**, not the deployed bot.
  A local allowlist does not stop the deployed bot from receiving that guild's
  events. Invite only the test application to the test guild, with bot and
  application-command scopes and the existing bot's channel/role/message
  permissions. Enable its Server Members intent for site-api server discovery.
  Add `http://localhost:9000` as its Discord OAuth redirect. Keep the existing
  SWA/Microsoft-plus-Discord login shell.
- Use a test Google service account and a separate **test Drive folder**, shared
  with that account. Enable Drive/Sheets APIs and give it access to the bot's
  existing sheet template. Do not copy production Google credentials or folders.
- Create a persistent native PostgreSQL cluster/database explicitly. An existing
  installer-managed local PostgreSQL instance is sufficient. For a new cluster,
  run PostgreSQL's `initdb` yourself once and start it before database creation.
  The launch target never runs `initdb`, creates databases, applies schemas,
  resets data, initializes hunts, or provisions hunt-level Discord/Google resources.

Create an ignored root `.env` using **local test values only** (merge carefully
if it already exists). Do not copy production settings:

```dotenv
LOCAL_POSTGRES_STACK=1
LOCAL_POSTGRES_GUILD_IDS=123456789012345678
GUILD_ALLOW_LIST=123456789012345678
GUILD_ID=123456789012345678
CLIENT_ID=<test-application-id>
VITE_BELLE_BOT_CLIENT_ID=<same-test-application-id>
DISCORD_TOKEN=<test-bot-token>
GOOGLE_API_KEY='<test-service-account-JSON-with-client_email-and-private_key>'
DATABASE_URL=postgresql://local_user:local_password@127.0.0.1:5432/local_hunts
PUZZLEHUNT_SERVICE_BASE_URL=http://127.0.0.1:3001
PUZZLEHUNT_SERVICE_TOKEN=<random-at-least-32-non-whitespace-characters>
PUZZLEHUNT_ALLOWED_ORIGINS=http://localhost:9000
LOCAL_FUNCTIONS_PATH='C:\path\to\Azure.Functions.Cli\func.exe'
```

`LOCAL_FUNCTIONS_PATH` must be the absolute **native executable**, not `func.cmd`
(an npm install normally places it beneath `azure-functions-core-tools\bin`).
On other platforms use the absolute native `func` path. `LOCAL_POSTGRES_STACK=1`
acknowledges the isolated test configuration; `LOCAL_POSTGRES_GUILD_IDS` remains
the bot's sole backend selector. Every selected guild must be explicitly allowed
and not blocked. Do not add production guilds to this configuration.

Set the same application ID in ignored
`packages/site/.env.local-postgres.local`:

```dotenv
VITE_BELLE_BOT_CLIENT_ID=<same-test-application-id>
```

Create ignored `packages/site-api/local.settings.json` from its sample with
`IsEncrypted: false`, `Values.FUNCTIONS_WORKER_RUNTIME: "node"`, and
`Values.DISCORD_TOKEN` equal to the **same test bot token**. `FLUID_RELAY_KEY` is
unused for PostgreSQL hunts. The launcher checks IDs/tokens across these files;
the bot also checks its logged-in identity. Never put database credentials,
Google credentials, Discord tokens, or the service token in `VITE_` variables.
Host environment variables override root `.env`; remove stale inherited
production settings rather than relying on a fallback.

For a **fresh** database only, run the existing setup explicitly:

```powershell
createdb --host=127.0.0.1 --username=local_user local_hunts
pnpm build:puzzlehunt-service
pnpm init:puzzlehunt-service 123456789012345678 "Local seed"
```

This unchanged initializer applies the schema and selects one empty seed hunt.
Do not rerun it on subsequent launches. `/create` may retain that one untouched
seed and create the requested hunt; it does not adopt/delete the seed. Partial,
configured, nonempty, or multiple prior hunts require manual inspection, not a
blind rerun. There is no setup-progress tracker, schema-only initializer, or resume.

Register slash commands **explicitly in the test guild**, never on launch:

```powershell
pnpm --filter @belle-puzzles/bot... build
# Ensure DEPLOY_EVERYWHERE is absent from both .env and the terminal environment.
Remove-Item Env:DEPLOY_EVERYWHERE -ErrorAction SilentlyContinue
node packages\bot\scripts\deploy-commands.js
```

Check `CLIENT_ID`, `GUILD_ID`, and `DISCORD_TOKEN` before this command. Do not run
`update-commands:prod` or deploy global commands for local testing.

### Database and process ownership

By default the launcher reuses the configured running database, verifies SQL and
the existing schema, and **never stops that instance**. If it is stopped and you
want this target to manage it, explicitly add both settings:

```dotenv
LOCAL_POSTGRES_BIN='C:\Program Files\PostgreSQL\18\bin'
LOCAL_POSTGRES_DATA_DIR='C:\local-data\belle-postgres'
```

The directory must already be initialized with the installed PostgreSQL version.
The database role needs permission to inspect `data_directory` for this option.
If an instance is already responding, its actual directory must match; it is
still reused and not owned. Otherwise the launcher starts the configured local
instance and stops only that instance after its dependents exit. It never stops a system
service, kills processes by name, or deletes the data directory. Database data,
hunts, active selections and durable work survive relaunch.

Each launch builds model/service/bot/site-api and typechecks the site once, then
waits in order for PostgreSQL SQL/schema, HTTP service, logged-in bot/worker,
Functions, Vite, and SWA. Use **http://localhost:9000**, not Vite directly.
Ports are fixed: bot 3000, service 3001, Vite 5173, Functions 7071, SWA 9000.
Bot/service bind to `127.0.0.1`; Vite/SWA use localhost. Core Tools controls its
own bind address; keep it behind your local firewall, never expose these dev
ports publicly. `PORT`/`HOST` overrides are process-scoped. Occupied app ports,
wrong readiness, missing schema/tools/config, and child exits fail explicitly.

Ctrl+C or one VS Code **Stop** triggers reverse-order teardown. Stateless
SWA/Vite/Functions process trees stop first; bot/worker and service receive
graceful shutdown (including on Windows), then only an owned database stops.
Allow shutdown to finish; forcing the debugger/terminal closed can bypass cleanup.
Graceful bot/service shutdown has a 35-second bound; a forced cleanup is reported
as an error and retained-write diagnostics require inspection. Restarting is not
automatic recovery of uncertain external effects.

### Acceptance smoke flow

Run `/create name: ... folder_link: <test-folder>` and `/add_round` in the test
guild. Open two authenticated tabs at localhost:9000, add/edit puzzles on both
surfaces, and use **Refresh hunt** to see remote edits and eventual Discord/Sheet
associations. HTTP rendering is deliberately non-live: no browser SQL or SSE.
Set a status, solve, refresh, and confirm the status/timestamp are cleared and
only one solve log appears.

To exercise outage recovery, stop only the bot via Ctrl+C in a separately started
bot terminal while keeping the HTTP/site processes running (use the per-package
commands in their READMEs with explicit ports). Make an HTTP/browser edit, restart
the bot, and confirm the worker catches up **without opening/refreshing a page**.
Refresh afterward to display its associations. Finally stop the entire stack and
relaunch against the same database to confirm persistence. The combined target
intentionally stops all dependents on any child exit, rather than silently
continuing a degraded stack.

`pnpm test:local-launch` covers isolated native database ownership/persistence,
readiness failures, and process-tree cleanup. The bot's `local-postgres.spec.ts`
uses real HTTP/native PostgreSQL with mocked Discord/Google for cross-layer
acceptance; it is not proof of real OAuth or external-service setup.
On Node 26 hosts with the existing jsdom `localStorage` incompatibility, scope
`NODE_OPTIONS=--no-experimental-webstorage` to the site test process only; do not
change production defaults.

## Bot Infrastructure

The discord bot is hosted on Azure using a container app. Deployment details can be found in the github workflows folder.

## Website Infrastructure

The website is hosted with azure static web apps. Deployment details can be found in the github workflows folder.

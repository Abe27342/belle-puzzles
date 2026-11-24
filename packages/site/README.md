# Belle Puzzles Website

## Local PostgreSQL hunts (opt-in, non-live)

Local PostgreSQL hunts require the `local-postgres` Vite development mode on a
loopback HTTP page. Production builds (including `vite build --mode local-postgres`)
do not enable them. The default/production website still uses Fluid.

Create `packages/site/.env.local-postgres.local` (ignored by Git) with:

```dotenv
VITE_BELLE_BOT_CLIENT_ID=<the local bot's CLIENT_ID>
```

`packages/site/.env.local-postgres` supplies
`VITE_BELLE_BOT_BASE_URL=http://localhost:3000`,
`VITE_PUZZLEHUNT_SERVICE_BASE_URL=http://localhost:3001`, and the existing local
Fluid fallback. Both API URLs must be loopback HTTP **origins**, without paths,
credentials, query strings, or fragments. Never put `DATABASE_URL`, `DISCORD_TOKEN`, or
`PUZZLEHUNT_SERVICE_TOKEN` in a `VITE_` variable.

With the local bot and puzzlehunt service configured and running, start the site
from the repository root:

```powershell
pnpm --filter @belle-puzzles/site start:local-postgres
```

Use **http://localhost:9000**, not Vite's port directly. The script runs Vite on
5173 behind the SWA emulator on 9000 and starts the `site-api` Azure Functions.
The existing SWA/Microsoft and Discord OAuth login shell remains. Register
`http://localhost:9000` as the local Discord application's OAuth redirect.
Use that same application's ID for the site, bot `CLIENT_ID`, and service
`VITE_BELLE_BOT_CLIENT_ID`. Configure the service with
`PUZZLEHUNT_ALLOWED_ORIGINS=http://localhost:9000`. In the ignored
`packages/site-api/local.settings.json`, `Values.DISCORD_TOKEN` must be the same
**local** bot's token so server discovery finds the right guilds. The
`FLUID_RELAY_KEY` is needed only for remote Fluid hunts, not local PostgreSQL hunts.

See [the bot's opt-in settings](../bot/README.md#local-postgresql-bot-opt-in) for
`LOCAL_POSTGRES_GUILD_IDS`, `GUILD_ALLOW_LIST`, the loopback database/service,
and server-only credentials. Create the hunt through Discord `/create` and its
first root round with `/add_round`; there is no browser creation/root-round flow.
For persistent full-stack startup, use
[the Local PostgreSQL stack target](../../README.md#local-postgresql-stack).

### Refreshing and saving

Local PostgreSQL hunts are **not live views**. Use **Refresh hunt** after pending
edits finish to see other users' edits and newly created Discord/Google resources.
These updates can also appear when you save another edit or reopen the page.
Resources that are not ready yet are shown as pending. Fluid hunts remain live.

Add, delete, solve, rename, URL, and sheet-ID edits appear immediately, but the
dialog stays open until saving finishes. Rejected edits are undone and the error
stays visible. If a save's outcome is uncertain, use **Retry pending edit** rather
than submitting the edit again.

Pending edits block in-app navigation/logout and warn before closing or reloading
the tab. **Keep the tab open**: confirming a reload/close loses the ability to retry
an uncertain save safely. If you need to sign in again, use the same account and
reopen the original guild in the same tab to retry pending edits. Do not reload to
resolve an uncertain save.
When the active hunt changes, use **Open selected hunt** after pending edits finish.
Login and service errors are displayed on the page.

## Running against a local belle-bot

TODO: restore this flow

First, add the bot to a test server and create a new puzzlehunt (TODO: Make an easy workflow for the bot
to create a local file; don't want the deployed bot responding to commands run on that server)

Then set the following two variables in a .env file:

LOCAL_DISCORD_SERVER_ID
LOCAL_FLUID_FILE_ID

Once complete, you can run the app against a local routerlicious server by running

`npm run start:azure-local`

in one terminal, then starting the dev server with

`npm run start`

Note that this stores the backing puzzlehunt documents in your local routerlicious server.
If you need to use this workflow with the discord bot, you'll also need to add the bot to a test server and create a new puzzlehunt.
The discord bot still needs a mechanism for the deployed bot to ignore commands on local servers, however (or you can just deploy
the commands to a specific server).

## Running against deployed belle-bot

[This guide](https://learn.microsoft.com/en-us/azure/static-web-apps/add-api?tabs=vanilla-javascript) is generally helpful.

Short version of relevant steps:

-   Install the Azure Functions and Azure Static Websites extensions from VS Code
-   Run `npm i -g @azure/static-web-apps-cli`
-   Run `npm run start`
-   Open a browser to `http://localhost:9000`.

This project uses an azure function to fetch tokens for the fluid relay service.
The architecture generally follows [these lines](https://learn.microsoft.com/en-us/azure/azure-fluid-relay/how-tos/azure-function-token-provider).

For additional debugging tips such as how to debug the API, [this doc may be useful](http://learn.microsoft.com/en-us/azure/static-web-apps/local-development).

## TODO

-   Improve puzzle page TreeView performance, right now rerendering behavior is quite egregious (and now that backing data format is tree-based, could actually get pretty efficient incremental inval without too much work)
-   Improve tab navigation on modal editor. May want to use dialog FAST component instead.
-   Improve overall setup running against local server + local bot instance.

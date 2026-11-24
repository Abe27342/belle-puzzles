# Belle Puzzles Website

## Public logic puzzle solvers

The unauthenticated `/solvers` index links to `/solvers/sudoku`,
`/solvers/masyu`, `/solvers/shingoki`, `/solvers/slitherlink`, `/solvers/cave`,
and `/solvers/hashi`. Each page shares the same text-input and solution UI and
uses the solver package's existing Cartesian grid renderer. Input stays in the
browser; no puzzle data is sent to an API.

Use dots for empty positions and equal-length rows. Each page documents its
clue format and includes a loadable example. Shingoki takes two equally sized
grids, separated by a blank line, for colors and lengths. Current text parsers
support only single-digit clues.

The first solution is displayed immediately. Only the second is precomputed to
determine uniqueness, then cached until **Find next solution** is clicked.
Subsequent solutions are computed on demand and displayed alongside earlier
ones. **Cancel** stops the session and preserves displayed solutions; changing
the input clears the old session and output.

Build the solver dependency before starting the site:

```sh
pnpm --filter @belle-puzzles/solver build
pnpm --filter @belle-puzzles/site start
```

Solver pages are lazy-loaded routes in the normal SPA, outside authentication
loaders and login gates. Navigation between the main site and solvers does not
reload the document. Leaving a solver route disposes its worker session.

Z3's JS/WASM assets are emitted at build time and served unbundled from
`/solver-assets/`.
See the [solver README](../solver/README.md#browser-integration) for runtime
ownership and thread cleanup.

## Cross-origin isolation

The entire SPA uses `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp`, enabling `SharedArrayBuffer` for
Z3's threaded WebAssembly runtime. These are isolation policies, not CORS
permissions. Vite development and preview servers set them globally;
`staticwebapp.config.json` supplies equivalent global deployment headers.
Other hosts must set the same headers on HTML and worker responses and retain
the SPA navigation fallback. HTTPS is required outside localhost.

Compatibility requirements:

| Surface | Behavior under isolation |
| --- | --- |
| Microsoft and Discord login | Existing full-page redirect flows do not depend on `window.opener`. PKCE state is stored in localStorage, not cross-window communication. |
| Discord avatars | Images request anonymous CORS; the public CDN permits cross-origin reads. |
| Discord API and OAuth token requests | Normal CORS fetch requests remain subject to the provider's CORS policy. COEP does not exempt requests from CORS. |
| Same-origin `/.auth/*` and `/api/*` requests | Existing cookies and API role restrictions remain in place. |
| Fluid Relay | HTTP requests still require server CORS support; COEP does not block WebSockets. Live authenticated connections must be verified against the configured relay. |
| Puzzle sheets and Drive folders | These are links to external pages, not embedded third-party frames. Cross-origin window opener relationships may be severed by COOP. |
| Bundled images, fonts, and scripts | Same-origin resources need no additional cross-origin permission. |

Before deploying isolation changes, test real Microsoft and Discord sign-in,
the OAuth return path, token refresh/session expiry, and an authenticated
puzzlehunt's Fluid connection and updates. Public response-header checks and
local mocked authentication do not replace these live checks. New popup-based
authentication or third-party embeds need their own compatibility review.

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

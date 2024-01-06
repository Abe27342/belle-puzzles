# Belle Puzzles Website

## Disclaimer

Despite documented engine requirements, all local workflows currently require node 16!

This is due to the issue mentioned [here](https://johnnyreilly.com/static-web-apps-cli-node-18-could-not-connect-to-api)

Specifically, using node 18 will likely present errors like the following:

```pwsh
[swa] ✖ Waiting for http://localhost:7071 to be ready
[swa] ✖ Could not connect to "http://localhost:7071". Is the server up and running?
[swa] node "C:\code\belle-puzzles\node_modules\.pnpm\@azure+static-web-apps-cli@1.0.6\node_modules\@azure\static-web-apps-cli\dist\msha\server.js" exited with code 0
--> Sending SIGTERM to other processes..
[api] cd "C:\code\belle-puzzles\packages\site-api" && "C:\Users\Abram\.swa\core-tools\v4\func" start --cors "*" --port 7071  exited with code 1
--> Sending SIGTERM to other processes..
[run] cd "C:\code\belle-puzzles\packages\site" && vite --mode remote-bot exited with code 1
✖ SWA emulator stoped because the --run command exited with code 1.
```

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

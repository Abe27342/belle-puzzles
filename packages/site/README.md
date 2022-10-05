# Belle Puzzles Website

## Running Locally

First, add the bot to a test server and create a new puzzlehunt (TODO: Make an easy workflow for the bot
to create a local file; don't want the deployed bot responding to commands run on that server)

Then set the following two variables in a .env file:

LOCAL_DISCORD_SERVER_ID
LOCAL_FLUID_FILE_ID

Once complete, you can run the app against a local routerlicious server by running

`npm run start:azure-local`

in one terminal, then starting the webpack dev server with

`npm run start`

Note that this stores the backing puzzlehunt documents in your local routerlicious server.
If you need to use this workflow with the discord bot, you'll also need to add the bot to a test server and create a new puzzlehunt.
The discord bot still needs a mechanism for the deployed bot to ignore commands on local servers, however (or you can just deploy
the commands to a specific server).

## Running against Azure Fluid Relay

[This guide](https://learn.microsoft.com/en-us/azure/static-web-apps/add-api?tabs=vanilla-javascript) is generally helpful.

Short version of relevant steps:

-   Install the Azure Functions and Azure Static Websites extensions from VS Code
-   Run `npm i -g @azure/static-web-apps-cli`
-   Run `npm run start:swa`
-   Open a browser to `http://localhost:9000`.

This project uses an azure function to fetch tokens for the fluid relay service.
The architecture generally follows [these lines](https://learn.microsoft.com/en-us/azure/azure-fluid-relay/how-tos/azure-function-token-provider).

For additional debugging tips such as how to debug the API, [this doc may be useful](http://learn.microsoft.com/en-us/azure/static-web-apps/local-development).

## TODO

-   Improve puzzle page TreeView performance, right now rerendering behavior is quite egregious (and now that backing data format is tree-based, could actually get pretty efficient incremental inval without too much work)
-   Improve tab navigation on modal editor. May want to use dialog FAST component instead.
-   Improve overall setup running against local server + local bot instance.
-   Follow the doc above to get a better local development setup.

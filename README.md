# Belle Puzzles

This repository hosts packages for the [Belle Puzzles bot and website](https://aka.ms/libracomplexity).

## Bot Infrastructure

TODO: Elaborate on this with pnpm update.

The discord bot is hosted on heroku. Build scripts are slightly customized in the root package.json to accomodate the monorepo structure:

-   [heroku-buildpack-lerna](https://github.com/Abe27342/heroku-buildpack-lerna.git) is used after the standard heroku/nodejs buildpack.
    As such, the [heroku-postbuild](https://devcenter.heroku.com/articles/nodejs-support#customizing-the-build-process) script is used to cancel the
    standard package build, since heroku-buildpack-lerna runs a more scoped install/build command.

## Website Infrastructure

The website is hosted with azure static web apps. Deployment details can be found in the github workflows folder.

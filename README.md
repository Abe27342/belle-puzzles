# Belle Puzzles

This repository hosts packages for the [Belle Puzzles bot and website](https://aka.ms/libracomplexity).

It uses [pnpm](https://pnpm.io/).

## Setup

1. Install [node 18](https://nodejs.org/en/download/) or later. I recommend using [nvm](https://github.com/nvm-sh/nvm) ([windows link](https://github.com/coreybutler/nvm-windows)) to manage node versions.
2. Install pnpm globally: `npm i -g pnpm`
3. Install repo dependencies: `pnpm i`
4. Build: `npm run build`

## Bot Infrastructure

The discord bot is hosted on heroku. As heroku doesn't support pnpm natively, [heroku-buildpack-npm](https://github.com/unfold/heroku-buildpack-pnpm) is explicitly set for deployment.

## Website Infrastructure

The website is hosted with azure static web apps. Deployment details can be found in the github workflows folder.

# Belle Puzzles

This repository hosts packages for the [Belle Puzzles bot and website](https://aka.ms/libracomplexity).

It uses [pnpm](https://pnpm.io/).

## Setup

1. Install [node 20](https://nodejs.org/en/download/) or later. I recommend using [nvm](https://github.com/nvm-sh/nvm) ([windows link](https://github.com/coreybutler/nvm-windows)) to manage node versions.
2. Enable corepack: `corepack enable`
3. Install repo dependencies: `pnpm i`
4. Build: `npm run build`

## TypeScript modules

The Node.js packages use `Node16` module and resolution settings: the bot and model
emit ESM, while the Azure Functions API retains CommonJS. Relative imports in the
ESM packages must name the emitted `.js` file, including type-only imports.
The Vite site and its tooling config use `ESNext` modules with `bundler` resolution.

The model's public subpaths resolve through its package `exports` and adjacent
declarations. TypeScript consumers must use `node16`, `nodenext`, or `bundler`
resolution; legacy `node` resolution is not supported.

## Bot Infrastructure

The discord bot is hosted on Azure using a container app. Deployment details can be found in the github workflows folder.

## Website Infrastructure

The website is hosted with azure static web apps. Deployment details can be found in the github workflows folder.

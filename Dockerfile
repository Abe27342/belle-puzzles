FROM node:22

WORKDIR /usr/src/app

RUN corepack enable

# Files required by pnpm install
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN pnpm fetch

# Bundle remaining app source
COPY . .

RUN pnpm install --frozen-lockfile -r --offline

RUN pnpm --filter @belle-puzzles/bot... build

EXPOSE 3000
CMD npm run start:bot

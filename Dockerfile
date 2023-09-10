FROM node:18

WORKDIR /usr/src/app

RUN corepack enable

# Files required by pnpm install
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN pnpm fetch

# Bundle remaining app source
COPY . .

RUN pnpm install --frozen-lockfile -r --offline

RUN npm run build

# TODO: Need to determine mechanism for secret injection.
EXPOSE 8080
EXPOSE 3000
CMD npm run start:bot

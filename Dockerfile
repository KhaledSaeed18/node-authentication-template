# syntax=docker/dockerfile:1

FROM node:24-alpine AS base
WORKDIR /app

# All dependencies; postinstall generates the Prisma client
FROM base AS deps
COPY package.json yarn.lock prisma.config.ts ./
COPY prisma ./prisma
RUN --mount=type=cache,target=/usr/local/share/.cache/yarn,sharing=locked \
    yarn install --frozen-lockfile --network-timeout 300000

# Compile TypeScript (includes the generated Prisma client)
FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN yarn build

# Production dependencies. Install scripts run so Prisma downloads its migration
# engine for this platform (the image runs as a non-root user and can't do it later).
FROM base AS prod-deps
COPY package.json yarn.lock prisma.config.ts ./
COPY prisma ./prisma
RUN --mount=type=cache,target=/usr/local/share/.cache/yarn,sharing=locked \
    yarn install --frozen-lockfile --production --network-timeout 300000

# Includes the Prisma CLI, schema and migrations so the same image can run
# `prisma migrate deploy` as a release step
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json prisma.config.ts ./
COPY prisma ./prisma
USER node
EXPOSE 4000
CMD ["node", "dist/server.js"]

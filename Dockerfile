# syntax=docker/dockerfile:1

FROM node:24-alpine AS base
WORKDIR /app

# All dependencies; postinstall generates the Prisma client
FROM base AS deps
COPY package.json yarn.lock prisma.config.ts ./
COPY prisma ./prisma
RUN yarn install --frozen-lockfile

# Compile TypeScript (includes the generated Prisma client)
FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN yarn build

# Production dependencies only
FROM base AS prod-deps
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production --ignore-scripts && yarn cache clean

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
EXPOSE 4000
CMD ["node", "dist/server.js"]

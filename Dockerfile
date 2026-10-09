# Official Node image, pulled from the AWS mirror of Docker Hub's library (no anonymous rate limit)
# Keep the runtime major aligned with .nvmrc and @types/node.
FROM public.ecr.aws/docker/library/node:24-alpine AS base
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

# Only what the server can reach from package.json: drops the Prisma CLI (and TypeScript),
# which Yarn installs as optional peers but the API never loads
FROM prod-deps AS runtime-deps
COPY docker/prune-node-modules.mjs /tmp/
RUN node /tmp/prune-node-modules.mjs /app prisma typescript

# Shared by the final images: OS patches, and no package managers (the app never uses
# them at runtime and they carry their own vulnerabilities)
FROM base AS hardened
ENV NODE_ENV=production
RUN apk upgrade --no-cache \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
        /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
        /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg

# Release step: applies pending migrations, then exits
FROM hardened AS migrate
COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json prisma.config.ts ./
COPY prisma ./prisma
USER node
CMD ["node_modules/.bin/prisma", "migrate", "deploy"]

# The API (default target)
FROM hardened AS runtime
COPY --from=runtime-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
    CMD wget -qO- "http://127.0.0.1:${PORT:-4000}/health" >/dev/null || exit 1
# instrumentation.js only starts OpenTelemetry when OTEL_EXPORTER_OTLP_ENDPOINT is set
CMD ["node", "--import", "./dist/instrumentation.js", "dist/server.js"]

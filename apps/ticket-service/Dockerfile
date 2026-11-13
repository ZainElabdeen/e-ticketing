# Ticket Service image. Build context is the repo root:
#   docker build -f apps/ticket-service/Dockerfile -t eticket/ticket-service:dev .
# Pure JS dependencies only, so the same file builds for linux/arm64.
FROM node:26-alpine AS build
# Node 26 no longer ships corepack; pin pnpm to the packageManager version.
RUN npm install -g pnpm@10.34.9
WORKDIR /repo

# Manifests first so the install layer is cached until a dependency changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/ticket-service/package.json apps/ticket-service/package.json
COPY apps/payment-service/package.json apps/payment-service/package.json
COPY apps/ledger-service/package.json apps/ledger-service/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/contract-tests/package.json packages/contract-tests/package.json
COPY packages/testing/package.json packages/testing/package.json
COPY packages/nest-common/package.json packages/nest-common/package.json
RUN pnpm install --frozen-lockfile --filter "@eticket/ticket-service..."

COPY . .
RUN pnpm --filter "@eticket/ticket-service..." build
RUN pnpm --filter @eticket/ticket-service deploy --prod --legacy /out
# The legacy deploy copies the whole package directory (dist included); keep
# only what runs: package.json, dist and the pruned node_modules.
RUN cd /out && rm -rf src test prisma prisma.config.ts Dockerfile jest*.cjs tsconfig*.json .env.example .turbo
# pnpm resolves the optional peers of @prisma/client (the prisma CLI and its
# studio/pglite/typescript tooling) into the prod tree; the runtime needs none
# of them because the client is generated at build time.
RUN cd /out/node_modules/.pnpm && rm -rf prisma@* @prisma+studio-core@* @electric-sql+pglite@* typescript@*

FROM node:26-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out ./
USER node
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3001/health/live || exit 1
CMD ["node", "dist/src/main.js"]

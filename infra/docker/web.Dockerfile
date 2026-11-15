# Static SPA served by nginx. Build context is the repo root:
#   docker build -f infra/docker/web.Dockerfile -t eticket/web:dev .
# Pure JS build and a multi-arch runtime image (linux/amd64 and linux/arm64).
FROM node:26-alpine AS build
# Node 26 no longer ships corepack; pin pnpm to the packageManager version.
RUN npm install -g pnpm@10.34.9
WORKDIR /repo

# Manifests first so the install layer is cached until a dependency changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/ticket-service/package.json apps/ticket-service/package.json
COPY apps/payment-service/package.json apps/payment-service/package.json
COPY apps/ledger-service/package.json apps/ledger-service/package.json
COPY apps/gateway/package.json apps/gateway/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/contract-tests/package.json packages/contract-tests/package.json
COPY packages/testing/package.json packages/testing/package.json
COPY packages/nest-common/package.json packages/nest-common/package.json
RUN pnpm install --frozen-lockfile --filter "@eticket/web..."

COPY . .
RUN pnpm --filter @eticket/web build

FROM nginxinc/nginx-unprivileged:1.31.7-alpine
COPY infra/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY infra/docker/nginx-security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
# The base image already runs as the unprivileged `nginx` user and listens on 8080 for the
# default config; this file keeps that port.
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1

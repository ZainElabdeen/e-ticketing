# One image per service: applies that service's hand-written SQL migrations
# with `prisma migrate deploy` as its owner role (ADR-0015). The build context
# is the repo root so the app's prisma/ folder can be copied in.
FROM node:26-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5

ARG SERVICE

WORKDIR /app

# The prisma pin in package.json must equal the apps' prisma pin (apps/*/package.json).
# Scripts stay enabled: prisma's postinstall prepares @prisma/engines; without it
# `migrate deploy` fails with "Can't write to /app/node_modules/@prisma/engines".
COPY infra/migrate/package.json infra/migrate/package-lock.json ./
RUN npm ci --omit=dev

COPY apps/${SERVICE}/prisma.config.ts ./prisma.config.ts
COPY apps/${SERVICE}/prisma ./prisma

USER node

# The pinned local binary; npx could fetch a different release.
CMD ["/app/node_modules/.bin/prisma", "migrate", "deploy"]

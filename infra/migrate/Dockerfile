# One image per service: applies that service's hand-written SQL migrations
# with `prisma migrate deploy` as its owner role (ADR-0015). The build context
# is the repo root so the app's prisma/ folder can be copied in.
FROM node:26-alpine

ARG SERVICE
ARG PRISMA_VERSION

WORKDIR /app

COPY infra/migrate/package.json ./package.json
RUN npm install --omit=dev "prisma@${PRISMA_VERSION}"

COPY apps/${SERVICE}/prisma.config.ts ./prisma.config.ts
COPY apps/${SERVICE}/prisma ./prisma

USER node

CMD ["npx", "prisma", "migrate", "deploy"]

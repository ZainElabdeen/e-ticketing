# .NET Ticket Service image (ADR-0021). Build context is the repo root:
#   docker build -f infra/docker/dotnet-ticket.Dockerfile -t eticket/ticket-service-dotnet:dev .
# No RID is set, so the same file builds for linux/amd64 and linux/arm64.

# Stage 1: bundle the OpenAPI contract the service serves at /docs, so a clean
# checkout builds without a prior `pnpm --filter @eticket/contracts build`.
FROM node:26-alpine AS contract
# Node 26 no longer ships corepack; pin pnpm to the packageManager version.
RUN npm install -g pnpm@10.34.9
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/ticket-service/package.json apps/ticket-service/package.json
COPY apps/payment-service/package.json apps/payment-service/package.json
COPY apps/ledger-service/package.json apps/ledger-service/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/contract-tests/package.json packages/contract-tests/package.json
COPY packages/testing/package.json packages/testing/package.json
COPY packages/nest-common/package.json packages/nest-common/package.json
RUN pnpm install --frozen-lockfile --filter "@eticket/contracts..."
COPY packages/contracts packages/contracts
RUN pnpm --filter @eticket/contracts bundle

# Stage 2: publish.
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /repo
COPY apps/ticket-service-dotnet/global.json apps/ticket-service-dotnet/Directory.Build.props apps/ticket-service-dotnet/Directory.Packages.props apps/ticket-service-dotnet/.editorconfig apps/ticket-service-dotnet/
COPY apps/ticket-service-dotnet/src/TicketService.Api/TicketService.Api.csproj apps/ticket-service-dotnet/src/TicketService.Api/
# Restore only the API project (the test project and its packages are not needed).
RUN cd apps/ticket-service-dotnet && dotnet restore src/TicketService.Api/TicketService.Api.csproj
COPY apps/ticket-service-dotnet/src apps/ticket-service-dotnet/src
COPY --from=contract /repo/packages/contracts/dist/ticket-service.json packages/contracts/dist/ticket-service.json
RUN cd apps/ticket-service-dotnet && dotnet publish src/TicketService.Api/TicketService.Api.csproj -c Release --no-restore -o /out

FROM mcr.microsoft.com/dotnet/aspnet:10.0-alpine
ENV PORT=3001
WORKDIR /app
COPY --from=build /out ./
USER app
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD wget -qO- http://127.0.0.1:${PORT}/health/live || exit 1
ENTRYPOINT ["dotnet", "TicketService.Api.dll"]

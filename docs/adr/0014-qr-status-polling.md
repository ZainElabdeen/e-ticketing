# ADR-0014: The SPA polls payment status for QR payments

## Context

A QR payment succeeds on the server 8 seconds after creation. The SPA must
show the result without the user refreshing.

## Decision

The SPA polls `GET /v1/payments/{paymentId}` every 1 s, stops on `SUCCEEDED`,
gives up after 60 s with a manual refresh, and pauses while the tab is hidden
(TanStack Query `refetchInterval`).

## Alternatives

- **Server-Sent Events**: push without polling, but needs streaming through
  the gateway and Traefik, and reconnection handling.
- **WebSocket**: bidirectional, which is not needed here.

## Trade-off

About 8 extra requests per QR payment, well inside the 100/min/IP limit.
Accepted for simplicity; SSE is the upgrade path.

# ADR-0028: Feature boundaries in the web SPA

Builds on ADR-0014 and ADR-0023 (feature folders, web toolchain).

## Context

The web app is organised in feature folders (`shop`, `checkout`, `qr`, `result`,
`backoffice`), but that was only a convention. Two cross-feature imports had
crept in: `qr/` read `checkout/paymentMemory`, and `result/` read `paymentKey`
from `qr/usePaymentPolling`. Features also reached into `app/` for
`useDocumentTitle`. Nothing stopped the next one.

## Decision

1. **Layers, imports point downward only**: `app` (router, layout, providers) ->
   features (`shop`, `checkout`, `qr`, `result`, `backoffice`) -> shared (`ui`,
   `lib`, `api`, `styles`, `payment`). A feature imports only itself and shared
   code; shared code imports no feature and not `app/`.
2. **Shared `src/payment/` module** holds the payment domain pieces used by
   several features: `paymentMemory` and the `paymentKey` query key. It may import
   `api/` and `lib/` only. `useDocumentTitle` moved from `app/` to `lib/` for the
   same reason.
3. **Enforced by lint**: ESLint core `no-restricted-imports` with per-folder
   `files` overrides in `apps/web/eslint.config.mjs`. Test files and `src/test/`
   are exempt because test helpers wire providers across features.

## Alternatives

- **`eslint-plugin-boundaries` / `eslint-plugin-import` `no-restricted-paths`**:
  stronger element typing, but a new dev dependency and plugin configuration.
- **Per-feature `index.ts` public APIs**: boilerplate for five features and
  barrel files hurt tree-shaking and test mocking.
- **Full Feature-Sliced Design** (pages, widgets, entities): too heavy for five
  screens.
- **TanStack Router or Zustand**: no capability gain over React Router, URL state
  and TanStack Query.

## Trade-off

The glob rules list the features explicitly, so a new feature folder must be
added to `FEATURES` in the ESLint config. In return the import direction is a
failing lint check, not a review comment, with no new dependency.

# Web SPA

React + Vite. Spec §5; ADR-0014, 0023. UI work: the `frontend-design` skill
(Claude Code); visual checks: the `ui-walkthrough` skill.

## CSP drives the code

nginx sends `script-src`/`style-src 'self'` with no `unsafe-eval`
(`infra/docker/nginx-security-headers.conf`).

- `src/zod-setup.ts` is the FIRST import in `main.tsx` (`z.config({ jitless: true })`
  before any schema exists).
- Styling is CSS Modules only, no `style=` attribute. Values come from
  `src/styles/tokens.css` (light theme only, by spec).
- Layout: `--gutter` switches at 560px; component media queries use
  `max-width: 559px`. Controls are at least 44px tall with square corners.

## Data and state

- API calls go through `useApi()` and `call()` (`src/api/errors.ts`), which throw
  `ApiError { status, code, retryAfterSeconds }`; a network failure is status 0,
  code `NETWORK_ERROR`. Map errors to text with the shared `messageFor`.
- The bearer token is attached only for `/v1/backoffice/` paths
  (`src/api/client.ts`). The session lives in memory first, mirrored to
  sessionStorage (`src/backoffice/session.ts`).
- Backoffice query keys start with `'backoffice'`: only a 401 on those logs the
  user out (`AuthProvider.tsx`).
- Shared query keys: `paymentKey` (`qr/usePaymentPolling.ts`, also used by
  `ResultPage`), `TICKET_TYPES_KEY` (`shop/useTicketTypes.ts`).
- Card data lives only in React Hook Form state and the POST body. Payment memory
  (`eticket.payment.<orderId>`) stores the payment id and method only.
- Double-submit guards are refs (`inFlight`, `cancelling`) released only on
  error. Keep that pattern.
- Backoffice tab and page live in the URL (`?tab=&page=`); `useClampPage`
  redirects out-of-range pages.
- `QrPage` mounts its `aria-live` region on first render so later text is
  announced; keep it mounted.

## Tests

- Helpers in `src/test/render.tsx`: `stubFetch(routes)` (no MSW; paths without
  `/api`, unmatched route → 599, `responses[]` for sequences) and
  `renderWithApp(ui, { route, path, fetch })`.
- Vitest uses non-scoped CSS module class names (`vite.config.ts`), so tests can
  query by class.
- No mock data in the app itself: every screen reads the real API.

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

## React standards

- **Feature folders** (`shop/`, `checkout/`, `qr/`, `result/`, `backoffice/`) own
  their pages, hooks, schemas and CSS. `ui/` holds presentational components
  used by two or more features (`Button`, `Banner`, `Stepper`, `Pagination`,
  `TicketStub`); they take props and render, with no data fetching.
- **State has one owner**: server data in TanStack Query, form input in React
  Hook Form, navigation state in the URL (params, `?tab=&page=`), and the rest in
  the nearest component that needs it. No global store; React context only for
  injected services (`ApiProvider`, `AuthProvider`).
- **Effects** synchronise with something outside React (timers, `visibilitychange`,
  storage, focus). Derive values during render; fetch through queries, not
  effects. Each effect cleans up what it starts. Logic with timing lives in a
  named hook with its own test (`useCountdown`, `usePaymentPolling`).
- **Server state**: query keys are exported constants or factories next to the
  hook that owns them. Retries follow the `QueryClient` default in `main.tsx`
  (no retry on 4xx). Mutations disable their trigger while pending.
- **Forms**: React Hook Form + `zodResolver`; the Zod schema is the single source
  of the rules and has its own unit test (`cardSchema.test.ts`). Errors render
  inline with `aria-invalid` + `aria-describedby`.
- **Routing**: routes are declared once in `src/app/router.tsx`; protected pages
  wrap in `RequireAuth`. Every route renders a recoverable message for an unknown
  or expired id.
- **Errors**: every query and mutation renders loading, error (via
  `messageFor`) and empty states. Render errors need a route `errorElement`
  (missing today, see `docs/engineering/initial-assessment.md` M1).
- **TypeScript**: types for API data come from `@eticket/contracts` through
  `src/api/types.ts`; no hand-written response types, no `any`.
- **Tests** use Testing Library queries by role and label, `userEvent` for
  interaction, and assert what the user sees.

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

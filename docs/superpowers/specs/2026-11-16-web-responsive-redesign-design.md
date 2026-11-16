# Web responsive redesign — design

Date: 2026-11-16 · Scope: `apps/web`, `.claude/skills/web-review`, `.claude/skills/ui-walkthrough`

## Intent

The SPA works but **looks unfinished for the demo**. Two problems:

1. **Layout.** Every page sits in one 880px column. On desktop the backoffice
   tables are cramped and the shop wastes the screen. On phones the backoffice
   tables scroll sideways. Only 4 media queries exist, all at one width (560px).
2. **Polish.** The "paper ticket" identity (cream paper, ink, stamp red, Archivo,
   tier colours) is a good idea but reads as a wireframe: square controls, a
   red primary button everywhere, a 6px side band as the only tier cue.

Success: a reviewer opening the demo on a laptop or a phone sees a finished
product, with a ticket shop that feels like tickets and a backoffice that feels
like a payments console.

## Goals

- Responsive at 320–1920px with no horizontal page scroll anywhere.
- Shop, checkout, QR and result in a refined **paper-ticket** style (direction A,
  informed by the Mastercard DESIGN.md from getdesign.md).
- Backoffice as a **console layout** in the same shop palette and type (amended
  2026-11-16): sidebar, summary tiles, clean tabular money columns.
- A written design system, `apps/web/DESIGN.md`, so later agents build to it.
- Port the useful saftaja-admin skill content into this repo's web skills.

## Non-goals

- No behaviour change: same routes, API calls, error mapping, idempotency-key
  lifecycle, polling, countdown and auth flow (spec §5 stays true).
- No new API endpoints or contract changes.
- No dark theme (spec: light only).
- No event photography or imagery.
- No code-review-graph skills (`debug-issue`, `explore-codebase`,
  `refactor-safely`, `review-changes`): they need an MCP server this repo does
  not have.

## Anti-goals (a failure even if it works)

- Looking like a generic SaaS template: the shop must still read as tickets.
- Mock or placeholder data on any screen (AGENTS.md: "No mock data").
- A11y or CSP regressions: `style=` attributes, inline scripts, contrast below
  AA, lost focus management, tabs/menu without keyboard support.
- Two diverging copies of shared components (`Button`, `Banner`, `Pagination`).

## Constraints

- CSS Modules only, no UI framework, **no new dependencies** (AGENTS.md).
  Archivo Variable stays the only font, for both areas.
- CSP `style-src 'self'`: no `style=` attributes. Dynamic values go through
  class names or CSS custom properties set in CSS, not inline.
- `src/styles/tokens.test.ts` asserts AA contrast for text tokens; every new
  text/background token pair is added to it.
- Controls ≥ 44px tall/tap area.
- Behaviour tests (Vitest + Testing Library) must stay green; any markup change
  that breaks a role/label query is a regression, not a test to rewrite.
- `apps/web/AGENTS.md` currently mandates **square corners** and a **560px**
  breakpoint. The approved mockups use rounded corners and a three-step scale.
  Both rules change (see "Rule changes").

## Approaches considered

1. **One token system, one theme per area (chosen).** `tokens.css` becomes the
   base (palette, type scale, spacing, radii, breakpoints). The backoffice shell
   sets `data-area="console"` on its root, and a `[data-area='console']` block
   sets only the row padding (`--row-pad`); colours stay the shop palette. Shared `ui/`
   components consume only semantic tokens, so one `Button` renders right in
   both areas. Trade-off: semantic token names must be chosen carefully so shop
   styling never leaks into the console.
2. **Two separate style kits.** The backoffice copies `Button`, `Banner` and
   `Pagination`. It is easier to change each area alone, but the copies drift.
   Rejected by the `app-architecture` rule against duplicate abstractions.
3. **Utility CSS framework (Tailwind etc.).** Rejected: banned by AGENTS.md and
   would need an ADR and a dependency.

The user picked 1.

## Decided by the user

| Decision | Choice |
| --- | --- |
| Shop / checkout / QR / result style | A: refined paper ticket |
| Backoffice style | Shop palette and type with console layout (amended 2026-11-16; was B: Stripe-style tables) |
| Build approach | 1: one token system, per-area theme |
| Backoffice shell | Left sidebar + three summary tiles; becomes a top menu below 1024px |
| Shop desktop layout | Three tickets side by side, total bar below |
| Mobile | Fully responsive; approved phone and tablet mockups (below) |

Mockups shown and approved live in `.superpowers/brainstorm/37249-1794797092/content/`
(git-ignored): `design-direction.html`, `backoffice-layout.html`,
`shop-layout.html`, `shop-mobile.html`.

## Design

### Breakpoints and layout tokens

| Name | Range | Use |
| --- | --- | --- |
| phone | < 640px | single column, sticky action bar |
| tablet | 640–1023px | 2-column ticket grid, backoffice top menu |
| desktop | ≥ 1024px | 3-column ticket grid, backoffice sidebar, 2-column checkout |

- Media queries use `min-width: 640px` and `min-width: 1024px` (mobile-first).
  CSS custom properties cannot be used in media queries, so the two values are
  documented in `tokens.css` and `DESIGN.md` and are the only breakpoint values
  allowed.
- Component-level reflow uses **container queries** (`container-type:
  inline-size`) where a component's own width matters more than the viewport.
  `TicketStub` is the main case: it is ~300px wide in the desktop grid and the
  full width on phones, so it folds its stub below the body by container width,
  not viewport width.
- Content widths: shop/checkout `--content-max: 1120px`; backoffice
  `--console-max: 1280px` beside the sidebar. Gutter 16px phone, 24px tablet,
  32px desktop.

### Tokens (`src/styles/tokens.css`)

Keep the existing palette values where they exist and add semantic layers.

- **Base palette (shop, from mockup A):** paper `#f3f0ee` (was `#f6f1e7`; the
  builder may keep the old value if contrast tests prefer it), card `#fcfbfa`,
  ink `#141413`/`#1b1f2a`, ink-muted `#5d6270`, rule `#d8cfbe`, stamp
  `#c8301a`, tier gold/premium/vip as today, ok `#2f6b3f`.
- **Console palette:** none (amended 2026-11-16). The console uses the shop
  palette; only `--row-pad` differs.
- **Semantic tokens** consumed by components: `--surface`, `--surface-raised`,
  `--text`, `--text-muted`, `--border`, `--accent`, `--accent-contrast`,
  `--focus-ring`, `--radius-sm` (4px inputs), `--radius-card` (6px cards), `--radius-pill` (20px buttons), `--row-pad`.
  The `[data-area='console']` block sets `--row-pad` only.
- **Spacing scale:** 4, 8, 12, 16, 24, 32, 48, 64 (`--space-1`… `--space-8`).
- **Type:** keep the current scale. Money and table numbers use
  `font-variant-numeric: tabular-nums`. Console headers and tile labels use the shop
  eyebrow style: 12px uppercase, 0.12em tracking, `--text-muted`.

### Shared components (`src/ui/`)

- **Button:** pill radius. Primary is ink fill with card text in both the shop and
  the console (`--accent` is ink everywhere). Quiet stays outlined. Stamp red
  is **no longer the primary button colour**. It is reserved for the PAID stamp,
  errors and the brand mark. Disabled and busy states unchanged.
- **TicketStub:** keep the notched mask. **Replace the 6px left tier band**
  with an eyebrow line ("ADMIT ONE · GOLD") in the tier colour above a dashed
  rule, as in the mockups. The side band is a recognisable AI-template pattern
  and the eyebrow carries the tier better. The stub folds below by container
  width. Tier colour text must pass AA on `--card` (add to `tokens.test.ts`;
  darken the eyebrow shade if needed, e.g. gold eyebrow `#8a6a1f`).
- **Stepper:** 40px round buttons inside 44px hit areas.
- **Banner, Pagination:** semantic tokens only, so both areas get the right look.
- **New `ui/StickyBar`:** a bottom-pinned action bar on phones (total + primary
  action) that renders inline from tablet up. It is presentational and takes
  children. The page keeps the real button, so tests still find it by role.
  Pages that use it reserve bottom padding so the bar never covers content.

### Shop (`/`)

- Desktop: 3-column grid of TicketStubs (Gold, Premium, VIP); total bar below
  (tickets count + total + Checkout).
- Tablet: 2 columns; the third ticket (VIP) spans the full row.
- Phone: one column; StickyBar holds "N tickets · total" and Checkout.
- Loading, error and empty states keep their current text and behaviour.

### Checkout (`/checkout/:orderId`)

- Desktop: two columns. Left: the order TicketStub (lines, total, countdown in
  the eyebrow), sticky while scrolling. Right: method choice as two pill radios
  (still a `fieldset` with native radios) and the card form or the QR button.
- Phone/tablet: stacked, order first. StickyBar holds the Pay / Show QR button.
- **Split `CheckoutPage.tsx` (309 lines)** to meet the ~120-line component
  rule: extract the order summary, the method picker and the expired/paid
  states into components in `checkout/`, and keep the payment orchestration in
  a hook (e.g. `useCheckoutPayment`). Pure move first, with tests green before
  and after, then restyle.

### QR (`/checkout/:orderId/qr/:paymentId`) and Result (`/result/:paymentId`)

- Same paper style. The QR code scales to `min(100%, 280px)` on phones. The
  ticket fills the width on phones and centres at ~560px on larger screens.
- Result shows the PAID stamp in `--stamp`, with transaction ID, payment
  reference, timestamp and amount in a tabular key/value list.
- The `aria-live` region in QrPage stays mounted on first render.

### Backoffice (`/backoffice`, `/backoffice/login`)

- A new shell component (`backoffice/ConsoleShell`) with `data-area="console"`.
- **Desktop (≥1024px):** 220px left sidebar (wordmark, the four sections, Sign
  out at the bottom) and the content area beside it, up to 1280px.
- **Below 1024px:** the sidebar becomes a top bar with the wordmark and a
  horizontal, scrollable section menu (the four sections stay visible as a strip,
  no hamburger needed for four items).
- **Accessibility:** the sections stay the existing **APG tabs** (`role=tablist`,
  roving tabindex, arrow/Home/End, `?tab=&page=` in the URL), with one tablist
  (`aria-orientation` left unset by design, all four arrow keys move focus) in the
  sidebar. This keeps the current tests and URL behaviour. Sign out is a button
  outside the tablist.
- **Summary tiles** above the active tab, on every tab: Revenue (balance of the
  Ticket Sales Revenue account), Transactions (`total` from the transactions
  list), Tickets left (sum of available / sum of quota from availability). They
  read existing `GET /v1/backoffice/*` endpoints with query keys starting with
  `'backoffice'`, and each tile has its own loading and error state. No new
  endpoint.
- **Tables (shop palette):** card panel, 6px radius, rule-colour rows, eyebrow-style
  12px headers, tabular right-aligned amounts, a Balanced / Out of balance pill on the ledger
  (text, not colour alone); there is no status column.
- **Phones (<640px):** each table row renders as a card using the **same
  `<table>` markup**, restyled with CSS (`display: block` rows). Cell labels do
  not come from `data-label` + `attr()` pseudo-elements, because generated text
  is unreliable for assistive tech. Each cell carries a visually hidden label
  `<span>` that becomes visible in card mode. Screen readers still get a table. The ledger keeps one card per
  journal entry, with its debit and credit lines inside.
- Login page: console style, centred card, same form behaviour.

### `apps/web/DESIGN.md`

A new file in the getdesign.md / Google Stitch format: YAML front matter with
the tokens (colours, type, radii, spacing, breakpoints) for both areas, then
prose sections (theme, colour roles, type, components, layout, responsive
rules, do's and don'ts, and an agent prompt guide). It states that it adapts the
Mastercard analysis from getdesign.md for both areas (the console reuses it;
it differs in layout and density only). Tokens in
`DESIGN.md` must match `tokens.css` and `apps/web/AGENTS.md` links to it.

### Rule changes and records

- **ADR-0027 "Web visual system and responsive layout":** the per-area theming,
  rounded corners, breakpoints (640/1024), container queries, sidebar console,
  DESIGN.md as the design source. Alternatives: approaches 2 and 3 above.
- `apps/web/AGENTS.md`: replace "square corners" and the "560px" layout line
  with the new radii and breakpoints, and point to `DESIGN.md`.
- Spec §5 backoffice row: "Tabs" becomes "Sections (sidebar on desktop, top
  menu below 1024px)"; add the summary tiles and the endpoints they read.

### Skills

- **`web-review`:**
  - Add an **Architecture pass** adapted from saftaja-admin's `app-architecture`:
    components and pages ≤ ~120 lines (excluding imports), split by extracting
    children, hooks or lib, not by compressing; feature folders own their code;
    `ui/` never imports from a feature; no `utils.ts`-style dumping grounds;
    don't share an abstraction until the behaviour and meaning match.
  - Update the **Design tokens pass** to the new rules (semantic tokens,
    radii, breakpoints 640/1024, DESIGN.md is the reference).
  - Update the **Responsive pass**: no `overflow-x` tables on phones (card mode).
- **`ui-walkthrough`:**
  - Add the backoffice sidebar/top-menu checks and the phone card-mode tables.
  - Add a **scripted Playwright option** adapted from saftaja's `verify` skill:
    a script kept in the scratchpad (Playwright is not a repo dependency) that
    loops the journeys over the seven widths and saves screenshots to
    `.playwright-mcp/`, plus a gotchas section.
  - The backoffice login is still typed by hand, so the walkthrough never reads
    `infra/.env`.

## Builder-check resolutions (designer's calls)

A zero-context builder review raised these. Each is settled here; none changes
what the user approved.

1. **Revenue tile:** the account with `code === '4000'` (Ticket Sales Revenue)
   from `GET /v1/backoffice/accounts`, shown as its API `balanceMinor` (the API
   already computes the balance; the Account balances tab shows the same value).
   Match by code, not name. The ledger migration seeds the account, so it is
   always present. If it is missing anyway, the tile shows "—" and no error.
2. **Tile queries share the tabs' cache entries:** Revenue uses
   `['backoffice', 'accounts']`, Tickets left uses
   `['backoffice', 'ticket-availability']`, and Transactions uses the transactions
   list at page 1 (the same key the tab uses for page 1, so the tile is stable
   while the user pages). A 401 on a tile logs out exactly like a tab does: the
   session is invalid either way, and `AuthProvider` already dedupes it.
3. **Tickets left:** `Σ available / Σ quota` using the API's `available` field
   (the same number the Availability tab shows). Reserved tickets count as not
   available.
4. **Chrome and theme scope:** the shop header (`Layout`) is hidden on every
   `/backoffice*` route. `Layout` keeps `<main>` and its focus handling. A
   backoffice route wrapper sets `data-area="console"` and covers **both**
   `/backoffice/login` and `/backoffice`, so the login card is console-styled. The
   sidebar and the top bar carry the wordmark, a "Shop" link and Sign out (when
   signed in). `RouteError` inside a backoffice route keeps a link back to the shop.
5. **Card-mode labels vs tests:** the hidden label `<span>` in each cell is
   `aria-hidden="true"`, so table semantics are unchanged on every width (the
   column header still names the cell). It is visible only in card mode, via CSS.
   **Empty cells get no label** (the ledger test asserts an empty credit cell).
   The existing assertions use substring `toHaveTextContent` and exact `getByText`
   on separate elements, so they keep passing. Rule: behaviour tests win. If one
   breaks only because it pinned old markup, the builder may adjust that
   assertion and must say so in the PR.
6. **Checkout states:** the expired and already-paid states replace both
   columns at full width. `StickyBar` is **not** portalled: it renders in the page
   flow with `position: sticky; bottom: 0` on phones, so the Pay button stays
   inside the card `<form>` and the tab order is unchanged.
7. **Section tabs:** one tablist at every width. It accepts all four arrows plus
   Home and End, and `aria-orientation` is left unset, so there is no JS
   breakpoint and no `matchMedia`. The layout switch is CSS only.
8. **Contrast gate covers both palettes:** `tokens.test.ts` asserts every text
   and background pair used, including card on ink, ok on card, and each tier eyebrow
   colour on `--card` (darken any that fail).

## Left to the builder

- Exact semantic token names and how the shop palette maps onto them.
- Whether `paper` becomes `#f3f0ee` or stays `#f6f1e7` (pick whichever keeps
  the tests and the look; record it in DESIGN.md).
- Hover and pressed states, transitions (respect `prefers-reduced-motion`).
- File split boundaries inside `checkout/` beyond the ones named above.
- How the summary tiles fetch (reuse the tab hooks or add small hooks).
- Task order in the plan. Suggested: tokens + DESIGN.md → shared ui → shop →
  checkout split + restyle → QR/result → backoffice shell + tiles → tables card
  mode → skills + AGENTS/spec/ADR → `ui-walkthrough` at seven widths + phase gate.

## Verification

- `pnpm --filter @eticket/web test`, `lint`, `build`; root `pnpm lint|build|test`.
- `tokens.test.ts` covers every new text/background pair (AA 4.5:1).
- `ui-walkthrough` at 320, 375, 430, 768, 1024, 1440 and 1920: no horizontal
  scroll, no CSP console errors, keyboard reach, 200% zoom reflow.
- The impeccable design hook reports no findings on changed files.

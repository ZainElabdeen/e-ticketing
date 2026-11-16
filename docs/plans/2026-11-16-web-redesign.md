# Web Responsive Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `apps/web` responsive from 320px to 1920px and demo-ready: a refined paper-ticket shop and checkout, and a Stripe-style console backoffice with a sidebar, summary tiles and phone card-mode tables.

**Architecture:** One token system in `src/styles/tokens.css`. The base palette serves the shop. A `[data-area='console']` block re-points semantic tokens for the backoffice. Shared `ui/` components read only semantic tokens. Layout is mobile-first, with breakpoints at 640px and 1024px. `TicketStub` reflows with container queries. Behaviour, routes and API calls do not change.

**Tech Stack:** React 19 + Vite + TypeScript, CSS Modules, TanStack Query, React Router, Vitest + Testing Library. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-16-web-responsive-redesign-design.md` (read it first; it holds the palette values, the layout per page and the 8 builder-check resolutions). Approved mockups: `.superpowers/brainstorm/37249-1794797092/content/*.html` (git-ignored, may be absent; the spec is authoritative).

**Branch:** `feat/web-redesign` (already created from `dev`; the design doc is committed).

## Global Constraints

- CSS Modules only. **No `style=` attribute**, no `dangerouslySetInnerHTML` (CSP `style-src 'self'`). `data-*` attributes are fine.
- No new dependencies. Archivo Variable is the only font.
- Breakpoints are exactly `min-width: 640px` (tablet) and `min-width: 1024px` (desktop), mobile-first. No other breakpoint values.
- Controls are at least 44px tall, or have a 44px hit area.
- Every text/background colour pair used is asserted ≥ 4.5:1 in `src/styles/tokens.test.ts`.
- Stamp red (`--stamp`) is no longer the primary button colour. Use it only for the PAID stamp, errors and the brand mark.
- Behaviour tests win. Keep every existing test green. Change an assertion only when it pinned old markup, not behaviour, and name each such change in the commit body.
- Do not change routes, API calls, query-key prefixes (`'backoffice'`), the idempotency-key lifecycle, polling, the countdown, payment memory or the auth flow (spec §5).
- Components and pages stay at about 120 lines or fewer, excluding imports.
- Never read or print `infra/.env`. The backoffice password is typed by the user during the walkthrough.
- Per-task check: `pnpm --filter @eticket/web test && pnpm --filter @eticket/web lint && pnpm --filter @eticket/web build`.

## Review Focus

1. **320px phone, all three tiers selected:** the sticky total bar must not cover the last ticket's stepper, and nothing scrolls sideways. Owner: Task 3, with a walkthrough check in Task 11.
2. **Order expires while the phone Pay bar is visible:** the bar and the Pay button must disappear with the form, and no stale enabled Pay may remain. Owner: Task 5 test.
3. **Session expires while tiles and the tab load together:** the user must be logged out once, with a single "Your session ended" message, not one per query. Owner: Task 8 test.
4. **Keyboard on the vertical sidebar:** ArrowDown and ArrowUp must move between sections the same way Right and Left do. Owner: Task 7 test.
5. **Ledger card mode with an empty debit or credit cell:** no orphan label shows, and the existing empty-cell assertion still passes. Owner: Task 9 test.

---

### Task 1: Tokens, contrast gate and DESIGN.md

**Files:**
- Modify: `apps/web/src/styles/tokens.css`, `apps/web/src/styles/global.css`, `apps/web/src/styles/tokens.test.ts`
- Create: `apps/web/DESIGN.md`

**Interfaces:**
- Produces (CSS custom properties; later tasks use only these names):
  - Semantic (defined in `:root`, re-pointed in `[data-area='console']`): `--surface` (page bg), `--surface-raised` (cards), `--text`, `--text-muted`, `--border`, `--accent` (primary fill), `--accent-contrast` (text on accent), `--accent-soft` (selected nav bg), `--focus-ring`, `--radius-card` (6px shop / 12px console), `--row-pad` (table cell padding).
  - Fixed: `--radius-sm: 4px`, `--radius-pill: 20px`; `--space-1..8` = 4, 8, 12, 16, 24, 32, 48, 64px; `--content-max: 1120px`; `--console-max: 1280px`; `--sidebar-w: 220px`; `--gutter` = 16px / 24px (≥640) / 32px (≥1024).
  - Palette: keep `--paper --card --ink --ink-muted --rule --stamp --tier-gold --tier-premium --tier-vip --ok`. Add `--tier-gold-text --tier-premium-text --tier-vip-text` (eyebrow text shades) and console `--c-canvas #f6f9fc --c-surface #ffffff --c-ink #0d253d --c-muted #5b6b82 --c-hairline #e3e8ee --c-accent #533afd --c-accent-soft #eef0ff --c-ok-bg #d7f7e2 --c-ok-fg #05690d`.
  - Shop mapping: `--accent: var(--ink)`, `--accent-contrast: var(--card)`. Console mapping: `--accent: var(--c-accent)`, `--accent-contrast: #ffffff` (define it as a `--c-on-accent` token so the test can read it).

- [ ] **Step 1: Extend `tokens.test.ts` (failing).** Keep the existing cases. Add:
  - pairs on `--card` for `tier-gold-text`, `tier-premium-text` and `tier-vip-text`;
  - `c-ink` and `c-muted` on both `c-canvas` and `c-surface`;
  - `c-on-accent` on `c-accent`;
  - `c-accent` on `c-accent-soft`;
  - `c-ok-fg` on `c-ok-bg`;
  - `card` on `ink` (the shop primary button).

  Each pair asserts `toBeGreaterThanOrEqual(4.5)`. The existing `token()` regex reads the first `--name: #hex;`, so give every new token a unique name.
- [ ] **Step 2:** Run `pnpm --filter @eticket/web test src/styles/tokens.test.ts`. Expected: FAIL (`token --tier-gold-text not found`).
- [ ] **Step 3:** Add the tokens to `tokens.css` and the `[data-area='console']` block. Paper stays `#f6f1e7` unless `#f3f0ee` also passes. Record the choice in DESIGN.md. Start the tier text shades from the tier colours and darken until they pass (gold starts at `#8a6a1f`). In `global.css`: body uses `var(--surface)` / `var(--text)`; `:focus-visible` uses `var(--focus-ring)` (shop: `--ink`; console: `--c-accent`).
- [ ] **Step 4:** Run the test again. Expected: PASS.
- [ ] **Step 5: Write `apps/web/DESIGN.md`** in the getdesign.md / Google Stitch format:
  - YAML front matter listing the tokens above for `shop` and `console`;
  - prose sections: Theme; Colour roles (stamp red's reserved use); Typography (Archivo, tabular numbers, 12px floor); Components (Button, TicketStub eyebrow, Stepper, StickyBar, console tables, status pills, tiles); Layout and breakpoints; Responsive rules; Do / Don't (no side-band accents, no `style=`, no new breakpoints); Agent prompt guide;
  - a note that it adapts the getdesign.md Mastercard (shop) and Stripe (console) analyses.

  Every value must match `tokens.css`.
- [ ] **Step 6:** Run the per-task check. Expected: all pass.
- [ ] **Step 7: Commit** `feat(web): semantic tokens, console theme and DESIGN.md`.

### Task 2: Shared UI — Button, Stepper, Banner, Pagination, TicketStub, StickyBar

**Files:**
- Modify: `apps/web/src/ui/Button.module.css`, `Stepper.module.css`, `Banner.module.css`, `Pagination.module.css`, `TicketStub.tsx`, `TicketStub.module.css`
- Create: `apps/web/src/ui/StickyBar.tsx`, `apps/web/src/ui/StickyBar.module.css`, `apps/web/src/ui/TicketStub.test.tsx`, `apps/web/src/ui/StickyBar.test.tsx`

**Interfaces:**
- Produces:
  - `TicketStub(props: { tier: StubTier; children: ReactNode; stub: ReactNode; eyebrow?: ReactNode })`. The default eyebrow for GOLD/PREMIUM/VIP is `Admit one · Gold|Premium|VIP`. NEUTRAL has no default. The eyebrow renders as `<p className={styles.eyebrow}>`, uppercased in CSS.
  - `StickyBar(props: { children: ReactNode }): ReactElement`. Renders `<div className={styles.bar}>`. It is pinned to the bottom on phones with `position: sticky; bottom: 0`, sits inline from 640px, and is never portalled.

- [ ] **Step 1: Failing tests.**
  - `TicketStub.test.tsx`: `it('shows the tier eyebrow')` renders tier GOLD and expects `getByText('Admit one · Gold')`. `it('uses a custom eyebrow')` passes `eyebrow="Your order"` and expects that text. `it('NEUTRAL has no default eyebrow')` expects `queryByText(/Admit one/)` to be null.
  - `StickyBar.test.tsx`: renders a `<button>Checkout</button>` child and expects `getByRole('button', { name: 'Checkout' })`.
- [ ] **Step 2:** Run `pnpm --filter @eticket/web test src/ui`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **TicketStub:** remove the 6px `::before` band. Add the eyebrow, coloured with `--tier-*-text` above a 1px dashed `--rule` divider. Set `container-type: inline-size` on `.ticket`. Replace `@media (max-width: 559px)` with `@container (max-width: 479px)`, which applies the existing folded-stub variables, so the stub folds below whenever the ticket is narrower than 480px. Use `--radius-card` only where the mask allows it; keep the notches.
  - **Button:** `border-radius: var(--radius-pill)`. Primary: `background: var(--accent); border-color: var(--accent); color: var(--accent-contrast)`. Quiet stays outlined in `--text`.
  - **Stepper:** 40px round buttons centred in 44px hit areas.
  - **Banner, Pagination:** semantic tokens only.
- [ ] **Step 4:** Run the per-task check. Expected: PASS, including the existing Shop, Checkout and Result tests.
- [ ] **Step 5: Commit** `feat(web): pill buttons, ticket eyebrow, container-query stub, StickyBar`.

### Task 3: Shop layout

**Files:**
- Modify: `apps/web/src/shop/ShopPage.tsx`, `ShopPage.module.css`, `apps/web/src/app/Layout.module.css`, `apps/web/src/shop/ShopPage.test.tsx`

**Interfaces:**
- Consumes: `StickyBar`, `TicketStub` (Task 2).

- [ ] **Step 1: Failing test** `it('shows the ticket count next to the total')`. Select 2 Gold and 1 VIP with the steppers, then expect `getByText('3 tickets')`. With 1 ticket selected the text is `1 ticket`; with 0 the count is hidden.
- [ ] **Step 2:** Run `pnpm --filter @eticket/web test src/shop`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The footer becomes `<StickyBar>` holding the count, `Total <strong>…</strong>` and the Checkout button.
  - `.list` is 1 column on phones. At ≥640px it is 2 columns, and the last ticket spans `1 / -1` when the count is odd (`:last-child:nth-child(odd)`). At ≥1024px it is 3 columns.
  - On phones `.main` gets enough `padding-bottom` that the bar never covers the last stepper.
  - In `Layout.module.css`: `.header` and `.main` use `--content-max`.
- [ ] **Step 4:** Run the per-task check. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): responsive shop grid with sticky total bar`.

### Task 4: Split CheckoutPage (pure refactor)

**Files:**
- Modify: `apps/web/src/checkout/CheckoutPage.tsx`
- Create: `apps/web/src/checkout/OrderSummary.tsx`, `MethodPicker.tsx`, `CheckoutClosed.tsx`, `useCheckoutPayment.ts`

**Interfaces:**
- Produces:
  - `OrderSummary(props: { order: Order; total: string; countdown?: ReactNode })`: the NEUTRAL TicketStub with the item lines. `Order` comes from `api/types`.
  - `MethodPicker(props: { method: 'CARD' | 'QR'; onChange: (m: 'CARD' | 'QR') => void })`: the `fieldset`, legend "How do you want to pay?" and the native radios, unchanged.
  - `CheckoutClosed(props: { kind: 'expired' | 'paid'; … })`: the expired and already-paid branches, with today's props and copy.
  - `useCheckoutPayment(...)`: owns `inFlight`, `busy`, `banner`, `notPayable`, `paidElsewhere`, `otherWindow`, `newKey`, `pay`. Its signature mirrors what `CheckoutBody` uses today. Keep the ref-based double-submit guard exactly.
  - `StartOver` and `TIER_NAMES` move to wherever they are used. Nothing is duplicated.

- [ ] **Step 1:** Run `pnpm --filter @eticket/web test src/checkout`. Expected: PASS (baseline).
- [ ] **Step 2:** Move code without changing behaviour or markup. Every resulting file is ≤ 120 lines excluding imports.
- [ ] **Step 3:** Run the per-task check. Expected: PASS, with no test file changed.
- [ ] **Step 4: Commit** `refactor(web): split CheckoutPage into summary, picker, closed states and payment hook`.

### Task 5: Checkout layout

**Files:**
- Modify: `apps/web/src/checkout/CheckoutPage.tsx`, `CheckoutPage.module.css`, `CardForm.tsx`, `CardForm.module.css`, `MethodPicker.tsx`, `apps/web/src/checkout/CheckoutPage.test.tsx`

**Interfaces:**
- Consumes: Task 4 components, `StickyBar`, and `TicketStub` `eyebrow`.

- [ ] **Step 1: Failing test** `it('removes the Pay button when the order expires')`, using fake timers in the existing countdown style. Render a payable order with `expiresAt` 2s ahead and advance 3s. Expect `getByText('This order has expired')`, and that no **enabled** button named `/^Pay /` remains (`queryAllByRole('button', { name: /^Pay / }).every(b => b.disabled)`).
- [ ] **Step 2:** Run `pnpm --filter @eticket/web test src/checkout`. If it already passes, keep it as a regression test and note that in the commit body.
- [ ] **Step 3: Implement.**
  - At ≥1024px the page is two columns. Left: `OrderSummary` with `position: sticky; top: var(--space-4)` and the countdown in its eyebrow (`Your order · valid 14:32`; the `role="timer"` element stays). Right: `MethodPicker` (pill-styled labels around the native radios) and the form.
  - Below 1024px it stacks, order first.
  - The Pay submit button and the Show QR button render inside `<StickyBar>` in the same `<form>` (CardForm) or pane, never portalled.
  - Closed states span both columns.
- [ ] **Step 4:** Run the per-task check. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): two-column checkout with sticky order and pay bar`.

### Task 6: QR and Result pages

**Files:**
- Modify: `apps/web/src/qr/QrPage.tsx`, `QrPage.module.css`, `apps/web/src/result/ResultPage.tsx`, `ResultPage.module.css`

- [ ] **Step 1: Implement.**
  - Both pages are centred, `max-width: 560px`, and full width on phones.
  - The QR code box is `width: min(100%, 280px)`. The `qrcode.react` SVG sizes from CSS through a class; no `style` prop.
  - Result: PAID stamp in `--stamp`. Transaction ID, payment reference, timestamp and amount go in a `<dl>` with tabular numbers.
  - Keep the QrPage `aria-live` region mounted on first render.
- [ ] **Step 2:** Run the per-task check. Expected: PASS with no test changes. If a test pinned markup, follow the Global Constraints rule.
- [ ] **Step 3: Commit** `feat(web): responsive QR and result pages`.

### Task 7: Console area, shell and sidebar

**Files:**
- Create: `apps/web/src/backoffice/ConsoleArea.tsx`, `ConsoleArea.module.css`, `ConsoleShell.tsx`, `ConsoleShell.module.css`
- Modify: `apps/web/src/app/router.tsx`, `apps/web/src/app/Layout.tsx`, `apps/web/src/app/Layout.test.tsx`, `apps/web/src/backoffice/BackofficePage.tsx`, `BackofficePage.module.css`, `LoginPage.module.css`, `apps/web/src/backoffice/BackofficePage.test.tsx`

**Interfaces:**
- Produces:
  - `ConsoleArea(): ReactElement` renders `<div data-area="console" className={styles.area}><Outlet /></div>`. In `router.tsx` it is a pathless route wrapping `/backoffice/login` and `/backoffice`, inside the existing `errorElement` group.
  - `ConsoleShell(props: { nav: ReactNode; children: ReactNode; onSignOut: () => void })`. Desktop (≥1024px): a `--sidebar-w` sidebar with the wordmark "E-Ticket", the nav, a "Shop" link to `/` and a Sign out button at the bottom; content up to `--console-max`. Below 1024px: a top bar with wordmark, Shop and Sign out, and the nav as a horizontally scrollable strip.
  - `Layout` hides its `<header>` when `pathname.startsWith('/backoffice')`. `<main>` and its focus handling stay.

- [ ] **Step 1: Failing tests.**
  - `Layout.test.tsx` `it('hides the shop header on backoffice routes')`: at `/backoffice/login`, `queryByRole('banner')` is null. At `/` it is present.
  - `BackofficePage.test.tsx` `it('moves between sections with ArrowDown and ArrowUp')`: focus the Transactions tab, press `{ArrowDown}`, expect the Ledger entries tab selected and focused; press `{ArrowUp}`, expect Transactions.
  - `it('links back to the shop')`: expect `getByRole('link', { name: 'Shop' })` with `href="/"`.
- [ ] **Step 2:** Run `pnpm --filter @eticket/web test src/app src/backoffice`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `BackofficePage` renders `ConsoleShell` with the existing tablist as `nav`.
  - In `onTabKeyDown`, ArrowDown maps like ArrowRight and ArrowUp like ArrowLeft. `aria-orientation` stays unset.
  - The selected tab uses `--accent-soft` bg and `--accent` text in the sidebar, and a 2px `--accent` underline in the strip.
  - Login page: a centred console card; behaviour unchanged.
- [ ] **Step 4:** Run the per-task check. Expected: PASS, with existing tab, pagination, logout and login tests green.
- [ ] **Step 5: Commit** `feat(web): console area with sidebar shell for the backoffice`.

### Task 8: Summary tiles

**Files:**
- Create: `apps/web/src/backoffice/queries.ts`, `SummaryTiles.tsx`, `SummaryTiles.module.css`, `SummaryTiles.test.tsx`
- Modify: `apps/web/src/backoffice/tabs/AccountsTab.tsx`, `AvailabilityTab.tsx`, `TransactionsTab.tsx`, `BackofficePage.tsx`

**Interfaces:**
- Produces (in `queries.ts`; the tabs switch to these, and the keys stay identical):
  - `accountsKey = ['backoffice', 'accounts'] as const`, `useAccounts()`
  - `availabilityKey = ['backoffice', 'ticket-availability'] as const`, `useAvailability()`
  - `transactionsKey = (page: number) => ['backoffice', 'transactions', page] as const`, `useTransactions(page: number)` (keeps `placeholderData: keepPreviousData` and the current page size)
  - `REVENUE_ACCOUNT_CODE = '4000'`
  - `SummaryTiles(): ReactElement` renders three tiles, each a `<section aria-label>` with a label and a value:
    - **Revenue:** `formatMinor(balanceMinor, currency)` of the account with `code === REVENUE_ACCOUNT_CODE`, or `—`.
    - **Transactions:** `useTransactions(1).data.total`.
    - **Tickets left:** `${Σ available} / ${Σ quota}`.

    Each tile shows `…` while loading and `messageFor(error)` on error.

- [ ] **Step 1: Failing tests** in `SummaryTiles.test.tsx`, using `stubFetch`/`renderWithApp`:
  - `it('shows revenue from account 4000')`: accounts include code `4000` with balance 70000 AED. Expect the Revenue tile to contain `AED 700.00`.
  - `it('shows a dash when the revenue account is missing')`.
  - `it('shows the transaction total')`: `total: 18`, expect `18`.
  - `it('sums tickets left')`: availability rows with available 72, 95 and 87 and quota 100 each. Expect `254 / 300`.
  - `it('logs out once when every backoffice query returns 401')`: render the full `BackofficePage` with all routes at 401. Expect exactly one `getByText('Your session ended. Sign in again.')`.
- [ ] **Step 2:** Run `pnpm --filter @eticket/web test src/backoffice`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Extract the queries from the tabs into `queries.ts` without changing the keys.
  - Mount `SummaryTiles` above the tabpanel. The grid is 3 columns at ≥640px and stacked below.
  - If the logout test shows duplicates, fix the dedupe in `AuthProvider` (logout is a no-op once already logged out). Do not touch the tiles to hide it.
- [ ] **Step 4:** Run the per-task check. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): backoffice summary tiles from existing endpoints`.

### Task 9: Console tables and phone card mode

**Files:**
- Create: `apps/web/src/backoffice/LabeledCell.tsx`, `LabeledCell.test.tsx`
- Modify: `apps/web/src/backoffice/tables.module.css`, `tabs/TransactionsTab.tsx`, `tabs/LedgerEntriesTab.tsx`, `tabs/AccountsTab.tsx`, `tabs/AvailabilityTab.tsx`

**Interfaces:**
- Produces: `LabeledCell(props: { label: string; className?: string; children?: ReactNode })`. It renders `<td className>`. When `children` is non-empty, it adds `<span aria-hidden="true" className={styles.cellLabel}>{label}</span>` before the children. With empty, null or `''` children it renders no label.

- [ ] **Step 1: Failing tests.**
  - `it('renders an aria-hidden label before the value')`: the label span has `aria-hidden="true"`, and the cell's text is `AmountAED 700.00`.
  - `it('renders no label for an empty cell')`: `toHaveTextContent` on an empty cell sees no label text (cell `textContent === ''`).
- [ ] **Step 2:** Run `pnpm --filter @eticket/web test src/backoffice/LabeledCell.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The tabs use `LabeledCell` for body cells, with labels equal to the column headers.
  - Console table style: white panel, `--radius-card`, hairline rows, 12px uppercase muted headers with 0.04em tracking, right-aligned tabular amounts.
  - Status as a pill with text: Succeeded on `--c-ok-bg`/`--c-ok-fg`; other statuses on neutral hairline and muted.
  - Below 640px: `table, tbody, tr, td { display: block }`, `thead` visually hidden, each `tr` a card, `.cellLabel` visible. The amount and status lead each card (use `order` within a flex row).
  - Ledger: one card per journal entry, with debit and credit lines inside, and the group row as the card header.
  - Remove `white-space: nowrap` and `overflow-x: auto` in card mode only.
- [ ] **Step 4:** Run the per-task check. Expected: PASS, with the existing ledger empty-cell assertion green.
- [ ] **Step 5: Commit** `feat(web): console tables with phone card mode`.

### Task 10: Rules, records and skills

**Files:**
- Create: `docs/adr/0027-web-visual-system-and-responsive-layout.md`
- Modify: `apps/web/AGENTS.md`, `docs/spec.md` (§5 backoffice row, §13 decision index), `.claude/skills/web-review/SKILL.md`, `.claude/skills/ui-walkthrough/SKILL.md`

- [ ] **Step 1: ADR-0027.**
  - Context: the demo looked unfinished, with one 880px column and one breakpoint.
  - Decision: per-area semantic theming; rounded corners (4/6/12/20px); 640/1024 breakpoints; container queries for TicketStub; sidebar console with tiles; DESIGN.md as the design source.
  - Alternatives: two style kits; Tailwind.
  - Trade-off: semantic token discipline.
  - Use the existing ADR format.
- [ ] **Step 2: `apps/web/AGENTS.md`.** Replace the "Layout: `--gutter` switches at 560px…square corners" line with the new breakpoints, radii and the semantic-token rule, and link `DESIGN.md`. Add `StickyBar`, `LabeledCell`, `ConsoleArea` and `ConsoleShell` to the folder notes.
- [ ] **Step 3: Spec §5.** In the `/backoffice` row, "Tabs: …" becomes "Sections (sidebar ≥1024px, top menu below): transactions, ledger entries, account balances, ticket availability; summary tiles (revenue = account 4000 balance, transaction total, tickets left)". Add ADR-0027 to §13.
- [ ] **Step 4: `web-review` skill.**
  - Add pass "0. Architecture", adapted from saftaja-admin `app-architecture`: ≤ ~120 lines per component or page excluding imports; split by extracting children, hooks or lib, not by compressing; feature folders own their code; `ui/` never imports a feature; no `utils.ts`/`helpers.ts` dumping grounds; share an abstraction only when the behaviour and meaning match.
  - Update pass 4 (Design tokens) to semantic tokens, the allowed radii, the 640/1024 breakpoints and DESIGN.md.
  - Update pass 6 (Responsive): phone tables use card mode, not `overflow-x`.
- [ ] **Step 5: `ui-walkthrough` skill.**
  - Add journeys: the sidebar at ≥1024px, and the top strip with card tables below 640px.
  - Add an optional **scripted mode**, adapted from saftaja's `verify`:
    - in the scratchpad: `npm init -y && npm i playwright@<pinned version>` (Playwright is not a repo dependency);
    - a script loops the shop journeys over 320, 375, 430, 768, 1024, 1440 and 1920;
    - it asserts `document.documentElement.scrollWidth <= innerWidth`;
    - it saves screenshots to `.playwright-mcp/`.
  - The backoffice in scripted mode stops at login, because the user types the password.
  - Add a Gotchas section (sticky bar overlap, container-query fold width).
- [ ] **Step 6:** Run `pnpm format:check`. Expected: PASS.
- [ ] **Step 7: Commit** `docs(web): ADR-0027, web rules, spec §5 and web skills for the redesign`.

### Task 11: Walkthrough and gate

- [ ] **Step 1:** Stack up: `docker compose -f infra/docker-compose.yml up -d --build --wait`. Seed with `infra/scripts/seed-demo.sh`.
- [ ] **Step 2:** Run the `ui-walkthrough` skill at all seven widths. It covers every journey, Review Focus items 1–5, zero CSP console errors, keyboard reach and 200% zoom. The user types the backoffice password.
- [ ] **Step 3:** Fix every issue found, test first where jsdom can express it. Commit each fix as `fix(web): …`.
- [ ] **Step 4:** Gate (`phase-gate` skill): `pnpm lint`, `pnpm format:check`, `pnpm build`, `pnpm test`, `pnpm test:int` all exit 0. Run the EGM drift check of spec §5 against the result.
- [ ] **Step 5:** Commit any report in the format the phase-gate skill uses.

## Out of scope

- Dark theme, imagery, new endpoints, contract changes, and any behaviour change in payments, auth or polling.
- Code-review-graph skills from saftaja-admin.

## Execution options

**A — Claude Code subagents (Sonnet 5.5):** execute with superpowers:subagent-driven-development, one implementer and one reviewer per task. Tasks 4 (refactor of payment orchestration) and 8 (auth logout path) get a stronger reviewer. Task 11 needs the user to be present for the backoffice login.

**B — OpenCode hand-off:**

```bash
opencode run "Read AGENTS.md, apps/web/AGENTS.md, docs/superpowers/specs/2026-11-16-web-responsive-redesign-design.md \
and docs/plans/2026-11-16-web-redesign.md. You are on branch feat/web-redesign; do not switch branches. Execute \
tasks 1 to 10 in order, test first where the task says so, run every verification and commit as each task says. \
CSS Modules only, never a style= attribute, no new dependencies, breakpoints only 640px and 1024px. Keep every \
existing test green; change an assertion only when it pinned markup and say so in the commit body. Never read or \
print infra/.env. Never run infra/scripts/smoke.sh. Stop before task 11 (it needs the user for the backoffice \
login) and report. If a verification fails twice, stop and report."
```

After either path, Claude reviews the branch (`repo-review` and `web-review` skills) and runs the drift check.

### Task 12: Backoffice uses the shop palette and type (user change, 2026-11-16)

User decision after Task 11: the backoffice keeps its layout (sidebar, tiles, tables, phone card mode) but uses **the same colours and fonts as the shop**. The Stripe palette is dropped.

**Files:**
- Modify: `apps/web/src/styles/tokens.css`, `tokens.test.ts`, `apps/web/src/backoffice/*.module.css`, `apps/web/DESIGN.md`, `docs/adr/0027-web-visual-system-and-responsive-layout.md`, `docs/superpowers/specs/2026-11-16-web-responsive-redesign-design.md` (Decided table + Tokens + Tables bullets), `apps/web/AGENTS.md` and `.claude/skills/web-review/SKILL.md` where they mention the console palette.

- [ ] **Step 1: Tokens.** `[data-area='console']` re-points no colour token any more: `--surface --surface-raised --text --text-muted --border --accent --accent-contrast --accent-soft --focus-ring` come from `:root` (shop). Keep `--row-pad: 12px 16px`. `--radius-card` follows the shop (6px). Delete the now-unused `--c-*` palette tokens and their `tokens.test.ts` cases. Any pair the console now uses that the test does not cover gets a case (e.g. `ok` on `card` already exists).
- [ ] **Step 2: Backoffice CSS.**
  - No `--c-*` reference remains in `apps/web/src`.
  - Login input borders use `1.5px solid var(--ink)`, like the card form.
  - The Balanced pill uses `--ok` text with an `--ok` border on `--surface-raised`; Out of balance uses `--stamp`.
  - The selected nav item uses `--accent-soft` (paper) bg with `--text`, and a 2px `--accent` (ink) bar or underline.
- [ ] **Step 3: Type.** Match the shop treatment: the wordmark, page `h1`, tile values and table group/total figures use `font-stretch: 75%; font-weight: 700` like shop prices and headings. Table header labels and tile labels use the shop eyebrow style (12px uppercase, `0.12em` tracking, `--text-muted`). Body text stays as `global.css`.
- [ ] **Step 4: Docs.** Update DESIGN.md (one palette for both areas; console = layout and density only), ADR-0027 (add an "Amended 2026-11-16" note: the console uses the shop palette and type at the user's request), spec (Decided table "Backoffice style: shop palette and type with console layout"; Tokens and Tables bullets), AGENTS.md and web-review pass 4 wording.
- [ ] **Step 5:** Run the per-task check and `pnpm format:check`. Then `grep -rn -- '--c-' apps/web/src` returns nothing.
- [ ] **Step 6: Commit** `feat(web): backoffice uses the shop palette and type`.

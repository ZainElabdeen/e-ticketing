# Web review 2026-11-16

- **Date:** 2026-11-16
- **Scope:** whole app (`apps/web`) at `7cc935c`
- **Fixed:** eight findings (report items 1 to 6, 21 and 27), listed below. All other findings stay open.

## Resolution

| Finding | Fix | Commit |
| ------- | --- | ------ |
| 1 Order expiry not announced | Expired notice is a `Banner tone="info"` (`role="status"`) | `ffb88ac` |
| 2 Ledger group header scope | `scope="rowgroup"` | `0c99770` |
| 3 Truncated transaction and order IDs | Full ID in the DOM, shortened by CSS from 640px, wraps on phones | `56ce479` |
| 4 Expiry `MM/YYYY` paste | Six digits read as MM plus the last two year digits | `1365038` |
| 5 Eager checkout and result routes | Route `lazy`; entry chunk 387.78 kB (120.19 kB gzip) to 269.21 kB (84.34 kB gzip) | `1b8967d` |
| 6 Banner side band | Uniform 1.5px border | `073cd64` |
| 21 (task item 7) Pagination focus loss | `aria-disabled` plus no-op click, live page label | `b2f6019` |
| 27 (task item 8) `crypto.randomUUID` on insecure origins | v4 fallback via `getRandomValues`; key lifecycle unchanged | `bec8e10` |

The brief numbered these 1 to 8; the last two are report findings 21 and 27.

---

# Web review: apps/web (whole app)

- **Scope:** whole app (`apps/web/src`, all features, `ui/`, `lib/`, `api/`, `payment/`, `styles/`)
- **Branch / HEAD:** `feat/web-redesign` @ `7cc935c`
- **Mode:** read-only review, `web-review` skill passes 0–8. No source files were edited.
- **Read first:** `apps/web/AGENTS.md`, `apps/web/DESIGN.md`, spec §5, ADR-0014, ADR-0023, ADR-0027, ADR-0028.
- **Gate run once:** `lint` exit 0; `test` 29 files / 223 tests passed; `build` exit 0 (bundle sizes in pass 7).
- **Pass 6:** done as **CSS-only** because the stack is down. Earlier, a scripted walkthrough at 7 widths passed for the shop, checkout, QR and result journeys. The backoffice after login has **not** been walked in a browser.
- **Out of scope:** items fixed just before this review and reviewed separately. They are not re-reported: cross-feature imports (`payment/` plus the ADR-0028 lint rule), QrPage/ShopPage size, card input formatting, the password toggle and backoffice freshness. Where a finding touches one of them, the row says so.

## Summary

| Severity | Count |
| -------- | ----- |
| Critical | 0 |
| High | 0 |
| Medium | 4 |
| Low | 30 |

## Findings (most severe first)

| # | Sev | Area | file:line | Evidence | Fix |
| - | --- | ---- | --------- | -------- | --- |
| 1 | Medium | A11y (WCAG 4.1.3 AA) | `src/checkout/CheckoutBody.tsx:69`, `src/checkout/CheckoutClosed.tsx:37` | When the countdown reaches zero, the payment pane is replaced by `<p className={styles.notice}>This order has expired</p>`. That text is not in a live region, and the `role="timer"` span (line 56) is not announced. A screen-reader user is not told, and the Pay button they were on disappears. | Render the expired notice through `Banner tone="info"` (`role="status"`), or keep a live region mounted in `CheckoutBody` and set its text when `expired` turns true. Test: advance the countdown past `expiresAt` and assert `getByRole('status')` contains "expired". |
| 2 | Medium | A11y (1.3.1) | `src/backoffice/tabs/LedgerEntriesTab.tsx:49` | `<th scope="colgroup" colSpan={3}>` heads each entry's `<tbody>`, which is a row group, not a column group. Assistive tech links the posted/reference/type header to the wrong cells. | Use `scope="rowgroup"`. Test: assert the `th` has `scope="rowgroup"`. |
| 3 | Medium | UX / A11y | `src/backoffice/tabs/TransactionsTab.tsx:46`, `:49` | `<span title={t.transactionId}>{t.transactionId.slice(0, 8)}</span>`, and the same for `orderId`. The transaction ID is a required backoffice field, but the full value exists only in `title`, which keyboard, touch and most screen-reader users cannot reach, and it cannot be copied. | Keep the full ID in the DOM and truncate it visually (`max-width` plus `text-overflow: ellipsis` from 640px, wrapping in card mode), or add the full ID as visually hidden text. Test: the row contains the full transaction ID. |
| 4 | Medium | UX (card form) | `src/checkout/cardFormat.ts:19` | `digitsOf(raw).slice(0, 4)`: if a browser autofills `cc-exp` as `MM/YYYY`, or the user pastes `12/2028`, the result is `12/20`. The schema then says "Card has expired". The input has no `maxLength` to steer autofill to `MM/YY`. Not on the deferred list; it touches the card-formatting change. | When the raw input has 6 digits, or matches `MM/YYYY`, keep the last two digits of the year. Add `maxLength={5}` to the expiry input. Test: `formatExpiry('12/2028', '')` returns `'12/28'`. |
| 5 | Low | Performance | `src/app/router.tsx:22`, `:28` | `CheckoutPage` and `ResultPage` are imported eagerly. Zod and react-hook-form end up in the entry chunk (`index-*.js` contains the zod "Invalid input" strings and RHF). The first load of `/` is `index` 387.75 kB (120.17 kB gzip) plus the shared chunk 113.53 kB (37.63 kB gzip), about 158 kB gzip. | Load `/checkout/:orderId` (and `/result/:paymentId`) through the route `lazy` property, as QR and backoffice already do. Re-measure the entry chunk. |
| 6 | Low | Tokens / DESIGN | `src/ui/Banner.module.css:5` | `border-left-width: 6px` with `.error { border-color: var(--stamp) }` is a coloured side band. DESIGN.md says: "Don't use side-band accents (coloured left or right borders on cards)." | Use a uniform 1.5px border (or a leading icon or label) instead of the 6px left band. |
| 7 | Low | Tokens | `src/app/Layout.module.css:7,20`, `src/shop/ShopPage.module.css:2,35,42`, `src/checkout/CheckoutPage.module.css:41,47,69,117,124,132`, `src/checkout/CardForm.module.css:10,27`, `src/qr/QrPage.module.css:48,63`, `src/result/ResultPage.module.css:9,25,38,69,85,112,114`, `src/backoffice/LoginPage.module.css:12,17,22,37,50`, `src/backoffice/tables.module.css:31,45,69,110,132,137,255,268`, `src/app/RouteError.module.css:2,9`, `src/ui/TicketStub.module.css:97` | About 35 spacing declarations use raw px (`gap: 16px`, `margin: 0 0 24px`, `padding: 0 12px`) where `--space-*` tokens exist. The rule is no raw px outside `tokens.css` except borders and breakpoints. | Replace them with `var(--space-N)` (4→1, 8→2, 12→3, 16→4, 24→5, 64→8). Raw px stays only for borders, 44px hit areas and TicketStub geometry. Verify in the browser; no test needed. |
| 8 | Low | Tokens | `src/result/ResultPage.module.css:16`, `:18` | The receipt mask uses `var(--ink)`, a raw palette token inside a component. | Use `#000` in the mask, as `TicketStub` does (mask alpha only), or a semantic token. |
| 9 | Low | Tokens / Typography | `src/backoffice/SummaryTiles.module.css:18`, `src/backoffice/tables.module.css:75`, `:219`, `src/ui/TicketStub.module.css:87-89` | The eyebrow style (`font-size: 0.75rem; letter-spacing: 0.12em; uppercase`) is copied in three places with a raw rem value. The TicketStub eyebrow differs from it: `var(--text-sm)` (14px), `0.08em`, weight 600. DESIGN.md defines one eyebrow style: 12px, 0.12em. | Add a `--text-xs: 0.75rem` token (and an eyebrow letter-spacing token), use it in all four places, and either align TicketStub or record the difference in DESIGN.md. |
| 10 | Low | Tokens (44px rule) | `src/app/Layout.tsx:27-30`, `src/app/Layout.module.css:1-15` | The shop header links "E-Ticket" and "Backoffice" are inline text with a line box of about 24 to 30px. Every other link-control in the app has `min-height: 44px`. They pass WCAG 2.5.8 (24px) but break the repo's 44px rule. | Give the header links `display: inline-flex; align-items: center; min-height: 44px`. |
| 11 | Low | Tokens / contrast | `src/ui/Button.module.css:22-26` | Disabled button text is `--text-muted` on `--border`, measured at **3.94:1**. That pair is not in `tokens.test.ts`. Disabled controls are exempt from WCAG, but the repo rule says every text/background pair in use is covered. The disabled primary "Checkout" button on first load reads faint. | Either add the pair to `tokens.test.ts` and darken it to 4.5:1 or more (for example `--text` at reduced emphasis on `--border`), or list it in DESIGN.md as a deliberate exemption. |
| 12 | Low | Architecture | `src/app/RouteError.module.css:5`, `src/checkout/CheckoutPage.module.css:128`, `src/qr/QrPage.module.css:67`, `src/result/ResultPage.module.css:117` | The same pill-link `.link` block (44px, 1.5px accent border, pill radius) is copied four times, along with `.actions` and `.quiet`. | Add a `ui/ButtonLink` (a `Link` styled like `Button variant="quiet"`) and use it everywhere. |
| 13 | Low | Architecture | `src/checkout/CardForm.tsx:46-80`, `src/backoffice/LoginPage.tsx:55-76`, `src/checkout/CardForm.module.css:25-38`, `src/backoffice/LoginPage.module.css:35-47` | The labelled input with `aria-invalid`, `aria-describedby` and an inline `role="alert"` error is built twice, by two `field()` render helpers, and its CSS is duplicated. | Add a `ui/TextField` (label, input, error); `PasswordField` can then use it too. |
| 14 | Low | Architecture (naming) | `src/backoffice/QueryFailure.tsx:23`, `src/backoffice/usePage.ts:4-19` | `QueryFailure.tsx` also exports a second `Loading` component, which shadows `app/Loading` by name. `usePage.ts` exports `useClampPage`, `PAGE_SIZE` and `TabProps`, but no `usePage`. | Move `Loading` to its own file (or reuse one shared quiet-loading component). Rename `usePage.ts` to `useClampPage.ts`, with `PAGE_SIZE` and `TabProps` next to `queries.ts`. |
| 15 | Low | React (query keys) | `src/backoffice/AuthProvider.tsx:41`, `:63`, `src/backoffice/BackofficePage.tsx:43`, `src/backoffice/UpdatingNote.tsx:12` | The root key `['backoffice']` (and `'backoffice'`) is written as a literal in four places, so the 401-logout contract depends on four copies matching. | Export `BACKOFFICE_ROOT = ['backoffice'] as const` from `queries.ts` and build every key from it. |
| 16 | Low | React (pure render) | `src/backoffice/RequireAuth.tsx:11` | `const expired = token !== null && loadSession() === null;` runs during render. `loadSession` wipes sessionStorage and sets the module flag `endedByExpiry`, so render has side effects. | Do the expiry check inside the existing effect (or keep `expiresAt` in auth state and compare it to `Date.now()` without side effects). |
| 17 | Low | React (empty state) | `src/backoffice/tabs/AccountsTab.tsx:15`, `src/backoffice/tabs/AvailabilityTab.tsx:13` | There is no empty branch. `data: []` renders a header-only table (Accounts shows only the Totals row), and the tile shows `0 / 0`. Unlikely in practice, because accounts and ticket types are seeded by migration. | Add "No accounts yet." and "No ticket types." branches, as the Transactions and Ledger tabs have. |
| 18 | Low | React (empty state) | `src/shop/ShopPage.tsx:42` | If `GET /v1/ticket-types` returns `[]`, the page shows only the heading. There is no message and no action. The data is seeded, so this is unlikely. | Add an "No tickets on sale right now" branch with a Try again button. |
| 19 | Low | A11y (4.1.3) | `src/checkout/CheckoutBody.tsx:62` | `<p className={styles.quiet}>Reconnecting…</p>` is not live, while the QR page's equivalent is (`QrStatus`, `aria-live="polite"`). | Wrap it in a mounted `aria-live="polite"` region, or reuse a status component. |
| 20 | Low | A11y | `src/shop/ShopPage.tsx:49-54` | The live total and the ticket count change on every Stepper click but are not announced. Only the Stepper `<output>` announces the quantity. | Put `aria-live="polite"` (or `<output>`) on the total paragraph. |
| 21 | Low | A11y (focus) | `src/ui/Pagination.tsx:19-26` | Pressing "Next" onto the last page disables the focused button, so keyboard focus falls back to `<body>`. "Page x of y" is not announced. | Use `aria-disabled` and ignore the click instead of `disabled` (focus stays put), or move focus to the other button. Add `aria-live="polite"` to the label. Test: after the click, focus is still on a pagination button. |
| 22 | Low | A11y (APG tabs) | `src/backoffice/BackofficePage.tsx:98` | The `role="tabpanel"` has no `tabIndex={0}`. The Accounts and Availability panels have no focusable content, so Tab skips from the tablist straight to the sidebar actions or the page end. | Add `tabIndex={0}` to the tabpanel, which the APG recommends when a panel has no focusable first element. |
| 23 | Low | A11y (landmarks) | `src/backoffice/SummaryTiles.tsx:13` | Each tile is a `<section aria-label>`, which adds three named region landmarks to the console. | Use a `<div>`, or a `<dl>` with label as `dt` and value as `dd`. |
| 24 | Low | UX (titles) | `src/backoffice/BackofficePage.tsx:29`, `:95`, `src/result/ResultPage.tsx:65` | The backoffice title and `h1` stay "Backoffice" for every section. The receipt page's document title is "Payment" while its `h1` says "Payment received". | Use `useDocumentTitle(\`${label} · Backoffice\`)` with the active tab label, and "Payment received" for the receipt. |
| 25 | Low | UX (copy) | `src/api/errors.ts:79-84` | `messageFor` maps `NETWORK_ERROR` (status 0) to "Something went wrong on our side. Try again.", which blames the server when the visitor is offline. | Add a `NETWORK_ERROR` branch, for example "Can't reach the server. Check your connection and try again." Test it in `errors.test.ts`. |
| 26 | Low | Functional (card) | `src/checkout/cardFormat.ts:7` vs `src/checkout/cardSchema.ts:19` | The formatter caps the number at 16 digits, but the schema accepts 12 to 19, so a valid 19-digit Luhn card cannot be typed. This touches the card-formatting change. | Cap at 19 and group as 4-4-4-4-3, or tighten the schema to 16 and say why in a comment. |
| 27 | Low | Robustness | `src/checkout/pay.ts:5` | `crypto.randomUUID()` exists only in secure contexts. Over `http://<LAN-IP>:8080` (phone testing against compose) Pay throws a `TypeError`, which becomes the generic banner, so every payment fails. Production (HTTPS) and `127.0.0.1` are not affected. | Fall back to a UUIDv4 built from `crypto.getRandomValues` when `randomUUID` is missing. Test: stub `randomUUID` as undefined and check the key format. |
| 28 | Low | Responsive (CSS-only) | `src/backoffice/tables.module.css:161`, `:215` | From 640px the tables switch to `display: table` with `white-space: nowrap` inside `.wrap { overflow-x: auto }`. By estimate, Accounts (six columns, three of them AED amounts, names like "Payment Gateway Clearing") and Transactions overflow the roughly 590px content box between 640 and about 900px, so they scroll sideways on tablets. | Check it in the backoffice walkthrough. If it overflows, keep card mode until 1024px for wide tables, or allow wrapping in text columns. |
| 29 | Low | Performance | `src/backoffice/BackofficePage.tsx:43` | `go()` invalidates every `['backoffice']` query on each tab or page change. Arrow-key browsing across the four tabs refetches the tiles' three queries plus the section on every keypress, against a 100/min/IP gateway limit. This touches the backoffice-freshness change. | Invalidate only the target section's key (and let the tiles keep their 15s interval), or debounce the arrow-key path. |
| 30 | Low | Layout | `src/app/Layout.tsx:21` | `inConsole` compares exact paths. `/backoffice/` (trailing slash) still matches the backoffice route, but gets the shop header and main padding around the console shell. | Normalise the trailing slash, or test with `matchPath`. |
| 31 | Low | UX | `src/shop/maxFor.ts:3` | `MAX_PER_TYPE = 10` is not shown anywhere. The "+" button disables at 10 with no reason when more tickets are available. | Show "Max 10 per order" near the Stepper when the cap is reached (or always). |
| 32 | Low | UX (busy feedback) | `src/checkout/CardForm.tsx:108`, `src/checkout/CheckoutBody.tsx:101` | While a payment is in flight, the only feedback is the disabled grey state (3.94:1, finding 11). There is no "Paying…" label or `aria-busy`. | Pass `busy` and render "Paying…" / "Preparing QR…" with `aria-busy`. |
| 33 | Low | A11y | `src/checkout/CardForm.tsx:74` | Each field error is `role="alert"`, so submitting an empty form fires up to four alerts at once. RHF also moves focus to the first invalid field. | Drop `role="alert"` on field errors (focus plus `aria-describedby` already announce them), or keep one summary alert. |
| 34 | Low | UX (wayfinding) | `src/checkout/CheckoutBody.tsx:61` | The checkout heading "Your order" does not say this is the payment step, and nothing shows the flow (pick → pay → receipt). | Retitle it "Pay for your order" (or "Checkout"). Optionally add a small step indicator, separate from `ui/Stepper`. |

## Checked clean

- **Architecture (pass 0):** no cross-feature or upward imports (`lint` passes with the ADR-0028 rule, and `FEATURES` lists all five features). `ui/` takes props only and never fetches. No component or page is over 120 lines excluding imports (the largest are `LoginPage` at about 104, `CheckoutBody` at about 96 and `ResultPage` at about 106). There are no `utils.ts`, `helpers.ts` or `hooks.ts` dumping grounds.
- **React (pass 1):**
  - Each piece of state has one owner: checkout method and backoffice tab/page live in the URL, card input in RHF, server data in Query.
  - Effects only synchronise with timers, focus, visibility or navigation, and each one cleans up.
  - Double submits are guarded by refs everywhere: `inFlight` in shop and checkout, `cancelling` in QR, `signingIn` in login.
  - Shared keys are `paymentKey` and `TICKET_TYPES_KEY`, and every backoffice key starts with `'backoffice'`.
  - Every page and tab has loading, error and recovery branches, with error text from `messageFor` or a wrapper around it.
- **Security (pass 2):**
  - The card number lives only in RHF state and the POST body, with `spellCheck={false}` on the card fields.
  - `paymentMemory` stores only `{paymentId, method}`, and the session is the only other storage key.
  - No `style=`, no `dangerouslySetInnerHTML`, no `console.*`.
  - The bearer token is attached only when the path starts with `${basePath}/v1/backoffice/` (`api/client.ts:29`).
  - `zod-setup` is the first import in `main.tsx`.
- **UI/UX (pass 3):** every journey has one primary action and a way forward from every error state (Try again, Start over, Back to checkout, Check again). Amounts go through `formatMinor` and dates through `formatDateTime` everywhere. The spec §5 error-code table is fully mapped.
- **Tokens (pass 4):**
  - The only breakpoints are `min-width: 640px` and `1024px`, plus the ADR-approved container query.
  - Radii come only from tokens; the round Stepper uses 50%, which is per DESIGN.
  - No raw hex except the QR `#fff` (allowed by DESIGN) and the mask `#000`.
  - `--stamp` is never used on a button.
  - Every text pair in use measures 4.5:1 or more: muted on paper 5.41, muted on card 5.99, stamp on paper 4.79, stamp on card 5.31, ok on card 6.27, gold 4.96, premium 6.05, vip 9.74, card on ink 16.19.
- **Accessibility (pass 5):**
  - One `h1` per rendered page, `lang="en"`, and labels on every input (the radios have a fieldset and legend).
  - A global `:focus-visible` ring.
  - Tabs use roving tabindex with Arrow, Home and End keys.
  - The QR live region is mounted on first render.
  - Focus moves to `<main>` and the document title updates on navigation.
  - The PAID stamp is `aria-hidden` and has sr-only text.
  - `prefers-reduced-motion` is honoured for the stamp animation.
- **Responsive (pass 6, CSS-only):** layout is mobile first, with no fixed widths or `min-width` above 320px. Phone tables use card mode through `LabeledCell`. `StickyBar` respects the safe-area inset. The console nav strip scrolls sideways below 1024px, as ADR-0027 intends.
- **Performance (pass 7):** QR polls at 1s, pauses while the tab is hidden and stops after 60s visible (ADR-0014). The backoffice refreshes every 15s only while visible. Checkout refetches only during the other-window state. QR, Login and Backoffice are lazy routes, and `qrcode.react` is only in `QrPage-*.js` (20.78 kB).
- **Tests (pass 8):** 223 tests cover the double-submit guards, idempotency key lifecycle, every spec §5 error code, QR polling cap, 429 back-off, tab keyboard, clamp page, 401 logout, session expiry and focus management.

## Behaviours with no test (pass 8)

- Countdown expiry announcement (finding 1).
- The tile error branch in `SummaryTiles` (no test asserts the tile text).
- Empty `accounts` and `availability` data (findings 17 and 18).
- `formatExpiry` with a 4-digit year (finding 4); a 19-digit card number (finding 26).
- `newIdempotencyKey` without `crypto.randomUUID` (finding 27).
- Pagination focus after the last page is reached (finding 21).
- `messageFor(NETWORK_ERROR)` copy (finding 25).
- `Layout` with a `/backoffice/` trailing slash (finding 30).

## Not checked

- **Real-browser walkthrough of the backoffice after login** (the stack is down). Card-mode rendering, the tablet table overflow (finding 28), the sticky sidebar and the CSP console were not seen at the seven widths.
- **CSP violations at runtime** (needs nginx). The source review found no inline style or script.
- **Screen-reader output** (VoiceOver, NVDA). The ARIA findings are from code reading only.
- **Real autofill behaviour** per browser for `cc-exp` (finding 4 is based on the documented `MM/YYYY` risk, not observed).
- **Lighthouse / Web Vitals.** Only build sizes were measured.

## Known, deferred (not new findings)

- The caret jumps to the end on mid-field edits of the card inputs.
- `formatExpiry` drops the year when a pasted month is above 12.
- "Updating…" repeats after a failed refetch (`UpdatingNote`).
- Tile error text duplicates the tab banner during an outage (`SummaryTiles`).
- Safari may drop table semantics in phone card mode (`display: block` on table elements, `tables.module.css:12-18`).

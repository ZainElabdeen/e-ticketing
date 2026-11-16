---
name: ui-walkthrough
description: Use after changing anything in apps/web or the nginx web config, or when asked to check the UI in a browser. Real-browser walkthrough at seven widths with CSP console, keyboard and accessibility checks.
---

# UI walkthrough

Tests in jsdom cannot see layout, CSP or focus. This skill drives the real
SPA served by nginx. Design critique itself: the `impeccable` /
`frontend-design` skills.

## Setup

1. Stack up: `docker compose -f infra/docker-compose.yml up -d --build --wait`.
2. Open `http://127.0.0.1:${WEB_HOST_PORT:-8080}` (check `WEB_HOST_PORT` by key
   name in `infra/.env`; never print values). Use the Playwright or Chrome tools.
3. Backoffice login: the user types the password by hand. The dev password
   lives in `infra/.env`; never read it from there.
4. Screenshots go to `.playwright-mcp/` (gitignored).

## Journeys

- Shop → checkout (card): Luhn-invalid number rejected, valid number reaches
  the result page with the transaction ID.
- Shop → checkout (QR): QR shows, polling flips to success after ~8 s; switch
  QR → card mid-flow; cancel.
- Expired or unknown order and payment URLs show a recoverable message.
- Backoffice: login, each tab (transactions, ledger, accounts, availability),
  pagination, logout, and a 401 after the token expires.
- Backoffice at 1024px and up: the sidebar shows the sections, the selected one
  is highlighted, summary tiles show revenue, transaction total and tickets left.
- Backoffice below 640px: the top strip scrolls its nav, and tables render as
  cards with a label per cell, with no horizontal scroll.

## At each width: 320, 375, 430, 768, 1024, 1440, 1920

- No horizontal page scroll (`document.documentElement.scrollWidth <= innerWidth`);
  phone tables are cards, not sideways scrollers.
- No clipped text, buttons or ticket stub outline; touch targets at least 44px.
- Forms, banners and the stepper stay readable.

## Every page

- Console: zero CSP violations and zero errors.
- Keyboard: Tab order follows the visual order, focus ring visible, every action
  reachable; Escape and Enter behave as expected.
- `aria-live` messages announce (QR status, form errors); 200% zoom reflows.

## Scripted mode (optional)

For a repeatable sweep without driving the browser by hand. Playwright is not a
repo dependency: install it in the scratchpad, never in the repo.

1. In the scratchpad: `npm init -y && npm i playwright@1.61.1` (then
   `npx playwright install chromium` if no browser is cached).
2. Write an `.mjs` script there that loops the shop journeys (home, card
   checkout, QR checkout, result) over 320, 375, 430, 768, 1024, 1440 and 1920.
3. At each step assert `document.documentElement.scrollWidth <= innerWidth` and
   collect console errors and CSP violations.
4. Save screenshots to `.playwright-mcp/`.
5. The backoffice stops at the login page: the user types the password, so the
   script never fills it. Check the backoffice by hand with the journeys above.

## Gotchas

- `StickyBar` is `position: sticky` at the bottom on phones: it can cover the last form field
  or the footer. Scroll the field into view and check the page has bottom
  padding; from 640px it is inline.
- `TicketStub` folds by container width (`@container (max-width: 479px)` on its
  `.frame` wrapper), not viewport width. A narrow column at 1440px folds too;
  check the stub where it sits, not only at phone widths.
- The console nav is one DOM: sidebar at 1024px and up, scrolling strip below.
  Do not look for a separate mobile menu.

## Done when

Every journey ran at every width, and the report lists each issue with width,
page, screenshot path and severity, or states the walkthrough found none.
Fixes go through TDD where jsdom can express them.

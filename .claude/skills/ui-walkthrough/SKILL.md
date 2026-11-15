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

## At each width: 320, 375, 430, 768, 1024, 1440, 1920

- No horizontal page scroll (`document.documentElement.scrollWidth <= innerWidth`);
  tables scroll inside their wrapper.
- No clipped text, buttons or ticket stub outline; touch targets at least 44px.
- Forms, banners and the stepper stay readable.

## Every page

- Console: zero CSP violations and zero errors.
- Keyboard: Tab order follows the visual order, focus ring visible, every action
  reachable; Escape and Enter behave as expected.
- `aria-live` messages announce (QR status, form errors); 200% zoom reflows.

## Done when

Every journey ran at every width, and the report lists each issue with width,
page, screenshot path and severity, or states the walkthrough found none.
Fixes go through TDD where jsdom can express them.

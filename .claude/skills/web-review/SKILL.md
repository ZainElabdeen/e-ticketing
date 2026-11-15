---
name: web-review
description: Use when reviewing, auditing or improving the web SPA (apps/web) — React code quality, UI/UX, design tokens, accessibility, responsive layout or performance — or before merging web changes. Produces severity-ranked findings, then optional test-first fixes.
---

# Web review and enhancement

Reviews `apps/web` against this repo's rules, then improves it. Read first:
`apps/web/AGENTS.md` (React standards, CSP rules), spec §5, ADR-0014, ADR-0023.
Design judgement: the `impeccable` / `frontend-design` skills when available.

## Scope

Pick one: the diff (`git diff dev...HEAD -- apps/web infra/docker/nginx*`), one
feature folder, or the whole app. State the scope in the report.

## Review passes

Run every pass over the whole scope. Each finding gets severity, `file:line`,
evidence (quoted code or a measured value) and a fix.

1. **React** — against the React standards in `apps/web/AGENTS.md`:
   - state with two owners (query data copied into `useState`, URL state
     mirrored in state);
   - effects that derive data, fetch, or miss a cleanup;
   - query keys built inline instead of shared; backoffice keys not starting
     with `'backoffice'`;
   - missing loading / error / empty branch; error text not from `messageFor`;
   - double-submit not guarded by a ref;
   - components in `ui/` that fetch or know a feature.
2. **Security** — card number outside form state and the POST body; anything
   written to storage beyond payment id/method and the session; `style=` or
   `dangerouslySetInnerHTML`; a token sent outside `/v1/backoffice/`.
3. **UI/UX** — each journey (shop, checkout card/QR, result, backoffice) has a
   clear primary action, a page heading that says where the user is in the
   flow, feedback within 100 ms of a click (disabled or busy state), and a way
   forward from every error. (`ui/Stepper` is the quantity picker, not a
   progress indicator.) Copy is consistent (AED
   amounts via `lib/money.ts`, dates via `lib/time.ts`).
4. **Design tokens** — colours, sizes and spacing come from
   `src/styles/tokens.css`; no raw hex or px values outside it except borders
   and breakpoints (`559px` / `560px`). Square corners, controls ≥ 44px.
5. **Accessibility** (WCAG 2.2 AA) — one `h1` per page; labels on every input;
   text contrast ≥ 4.5:1 (compute from token hex values); keyboard reaches
   everything with a visible focus ring; ARIA widgets follow their APG pattern
   (tabs: roving tabindex + arrow keys); `aria-live` for async status; focus
   and document title move on navigation.
6. **Responsive** — run the `ui-walkthrough` skill (seven widths, CSP console).
   Without a browser, review CSS for fixed widths, `min-width` wider than 320px,
   and tables outside an `overflow-x: auto` wrapper, and mark the pass
   "CSS-only".
7. **Performance** — bundle size from `pnpm --filter @eticket/web build`
   output; route-level `lazy()` candidates (backoffice); polling intervals and
   `refetchOnWindowFocus` on heavy queries; re-renders from unstable props.
8. **Tests** — each finding fixed later needs a test that fails first; list
   behaviours with no test (render-time branches, error paths).

## Report

Findings table, most severe first:

| Sev | Area | file:line | Evidence | Fix |
| --- | ---- | --------- | -------- | --- |

Severity: **Critical** (card data leak, auth bypass), **High** (broken journey,
WCAG A failure), **Medium** (WCAG AA failure, missing state, wrong ownership),
**Low** (polish). Then list areas checked clean and areas not checked.

## Enhancing (only after the user picks findings)

1. One branch, one commit per finding (`fix(web): …`).
2. Test first (Vitest + Testing Library); CSS-only fixes are verified in the
   browser instead.
3. Run `ui-walkthrough` for anything visual.

## Done when

Every pass ran over the full scope (or is marked not run with the reason),
every finding has evidence and a location, and for enhancements
`pnpm --filter @eticket/web test`, `lint` and `build` pass.

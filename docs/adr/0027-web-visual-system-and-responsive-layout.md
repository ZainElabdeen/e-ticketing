# ADR-0027: Web visual system and responsive layout

Amends ADR-0023 (web toolchain: CSS Modules stay) and the "square corners" and
560px layout rules in `apps/web/AGENTS.md`.

## Context

The demo looked unfinished: one 880px column, one breakpoint (560px), square
corners everywhere and a single flat palette shared by the shop and the
backoffice. Desktop screens wasted space and backoffice tables scrolled
sideways on phones.

## Decision

1. **Per-area semantic theming.** `src/styles/tokens.css` defines semantic
   tokens (`--surface`, `--surface-raised`, `--text`, `--text-muted`, `--border`,
   `--accent`, `--accent-contrast`, `--accent-soft`, `--focus-ring`,
   `--radius-card`, `--row-pad`). The shop uses paper and ink; the console
   block (`data-area='console'`, set by `ConsoleArea`) only sets `--row-pad`
   (see Amended 2026-11-16). Components read only semantic tokens.
2. **Rounded corners**: 4px inputs, 6px cards, 20px buttons and status pills.
3. **Breakpoints**: mobile first, exactly `min-width: 640px` and
   `min-width: 1024px`. `--gutter` is 16, 24 and 32px. Content caps at 1120px
   (shop) and 1280px (console).
4. **Container query for `TicketStub`**: it folds at `@container (max-width:
   479px)` on an outer `.frame` wrapper, so it reacts to the space it gets, not
   the viewport.
5. **Console layout**: a sidebar from 1024px, a top bar with a scrolling nav
   strip below it (one DOM, CSS only, `ConsoleShell`), summary tiles built from
   existing endpoints, and tables that become cards on phones (`LabeledCell`).
   `StickyBar` pins the primary checkout action on phones.
6. **`apps/web/DESIGN.md`** is the design source of truth for agents;
   `tokens.css` stays the source of truth for values, and `tokens.test.ts`
   asserts every text/background pair at 4.5:1 or more (console input borders
   use `--text`).

## Alternatives

- **Two style kits** (separate shop and console CSS): duplicates every
  component and drifts apart.
- **Tailwind**: a new dependency and a second styling system; ADR-0023 chose CSS
  Modules and the CSP forbids inline styles.

## Trade-off

Components must use semantic tokens only; a raw colour or a one-off breakpoint
breaks the theme switch, so the discipline is enforced in review
(`web-review` skill) and by the contrast test. In return one component set
serves both areas and every width.

## Amended 2026-11-16

At the user's request the console uses the shop palette and type. The
`--c-*` palette, the violet accent and the 12px console card radius are
removed. The console keeps its layout (sidebar, tiles, tables, phone card
mode) and `--row-pad`; wordmark, tile values and table figures use the shop's
width 75% / weight 700, and table and tile labels use the shop eyebrow style.

---
name: E-Ticketing
description: Paper and ink palette for the shop and the backoffice console (the console differs in layout and density only).
colors:
  shop:
    paper: '#f6f1e7'
    card: '#fffdf8'
    ink: '#1b1f2a'
    ink-muted: '#5d6270'
    rule: '#d8cfbe'
    stamp: '#c8301a'
    tier-gold: '#b8902f'
    tier-premium: '#4f6475'
    tier-vip: '#6e2b4f'
    tier-gold-text: '#8a6a1f'
    tier-premium-text: '#4f6475'
    tier-vip-text: '#6e2b4f'
    ok: '#2f6b3f'
semantic:
  shop:
    surface: paper
    surface-raised: card
    text: ink
    text-muted: ink-muted
    border: rule
    accent: ink
    accent-contrast: card
    accent-soft: paper
    focus-ring: ink
    radius-card: 6px
    row-pad: 10px 12px
  console:
    note: no colour overrides, shop tokens apply
    row-pad: 12px 16px
typography:
  family: Archivo Variable
  scale: { sm: 0.875rem, base: 1rem, md: 1.25rem, lg: 1.75rem, xl: 2.5rem, 2xl: 3.5rem }
  numerals: tabular
  floor: 12px
rounded: { sm: 4px, pill: 20px, card: 6px }
spacing: { 1: 4px, 2: 8px, 3: 12px, 4: 16px, 5: 24px, 6: 32px, 7: 48px, 8: 64px }
layout:
  content-max: 1120px
  console-max: 1280px
  sidebar-w: 220px
  gutter: { base: 16px, tablet: 24px, desktop: 32px }
  breakpoints: { tablet: 640px, desktop: 1024px }
---

# Design: E-Ticketing

This file adapts the getdesign.md Mastercard analysis. The console reuses the
shop palette and type (amended 2026-11-16). `src/styles/tokens.css` is the source of truth; every value here
matches it, and `src/styles/tokens.test.ts` asserts the contrast pairs.

## Theme

One palette serves both areas: warm paper, ink type and ticket-stub cards. The
console (`data-area='console'`, sidebar, tiles, tables) differs in layout and
density only (`--row-pad: 12px 16px`); it re-points no colour. Components read
only semantic tokens (`--surface`, `--text`, `--accent` and so on). Light theme only.

Paper stays `#f6f1e7`. The alternative `#f3f0ee` was not needed because all pairs pass.

## Colour roles

- Shop primary action: `--accent` (ink) with `--accent-contrast` (card).
- Stamp red (`--stamp`) is reserved: the PAID stamp, errors and the brand mark. It is
  never a button colour.
- Tier colours (`--tier-*`) fill bars and swatches. Eyebrow text uses `--tier-*-text`,
  darkened to pass 4.5:1 on `--card`.
- Console: selected nav uses `--accent-soft` with `--text` and a 2px `--accent` bar;
  the Balanced pill is `--ok` text and border on `--surface-raised`, Out of balance
  is `--stamp`. Login input borders are `1.5px solid var(--ink)`.
- Every text and background pair in use is asserted at 4.5:1 or more.

## Typography

Archivo Variable only, self-hosted. Headings use width 75% and weight 700; body is
width 100%. Console wordmark, tile values and table group/total figures use the same
width 75%, weight 700. Table headers and tile labels use the eyebrow style (12px,
uppercase, 0.12em tracking, `--text-muted`). Tabular numbers everywhere (prices, counts, ids). Nothing below 12px.

## Components

- **Button**: at least 44px tall, 4px radius. Primary is `--accent` on `--accent-contrast`.
- **TicketStub eyebrow**: small uppercase tier label in `--tier-*-text` above the tier name.
- **Stepper**: numbered checkout steps, current step in `--accent`.
- **StickyBar**: bottom bar on mobile carrying total and primary action; static from tablet up.
- **Console tables**: `--surface-raised`, `--border` hairlines, `--row-pad` cells, radius `--radius-card`.
- **Status pills**: `--radius-pill`; success uses `--ok` text and border on `--surface-raised`.
- **Tiles**: raised cards with `--radius-card`, label in `--text-muted`, value in `--text`.

## Layout and breakpoints

Mobile first with exactly two breakpoints: `min-width: 640px` (tablet) and
`min-width: 1024px` (desktop). `--gutter` is 16px, 24px, 32px. Shop content caps at
`--content-max` (1120px), console at `--console-max` (1280px) with a `--sidebar-w`
(220px) sidebar from desktop. Spacing uses `--space-1..8`.

## Responsive rules

- Controls are at least 44px tall or have a 44px hit area.
- Tables collapse to stacked rows or scroll inside their container on mobile; the page never scrolls sideways.
- Sidebar becomes a top nav below 1024px.

## Do / Don't

- Do style with CSS Modules and semantic tokens.
- Do keep contrast tests green when a colour changes.
- Don't use side-band accents (coloured left or right borders on cards).
- Don't use the `style=` attribute (CSP `style-src 'self'`).
- Don't add breakpoints beyond 640px and 1024px.
- Don't use `--stamp` for primary buttons.

## Agent prompt guide

"Build with CSS Modules. Use only semantic tokens from `src/styles/tokens.css`
(`--surface`, `--surface-raised`, `--text`, `--text-muted`, `--border`, `--accent`,
`--accent-contrast`, `--accent-soft`, `--focus-ring`, `--radius-card`, `--row-pad`)
and `--space-*`. Mobile first; media queries at 640px and 1024px only. Controls 44px
minimum. Console pages sit under `data-area='console'`. Add any new text/background
pair to `tokens.test.ts`."

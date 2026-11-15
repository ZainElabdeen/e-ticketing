# ADR-0023: Web app toolchain and serving

## Context

Spec §5 and AGENTS.md list the core web libraries: React Router, TanStack Query,
React Hook Form + Zod, openapi-typescript + openapi-fetch, CSS Modules,
qrcode.react, Vitest + Testing Library. A working Vite SPA needs a few more
packages, and the nginx CSP for the SPA allows only `'self'` for scripts, styles
and fonts.

## Decision

Companion packages beyond the AGENTS.md list (all pinned exactly):

- `@vitejs/plugin-react`: JSX transform and fast refresh for Vite.
- `@hookform/resolvers`: connects Zod schemas to React Hook Form.
- `jsdom`: the DOM that Vitest runs component tests in.
- `@testing-library/user-event`: realistic clicks and typing (double-click tests).
- `@testing-library/jest-dom`: readable DOM matchers.
- `@testing-library/dom`: peer of `@testing-library/react`.
- `eslint-plugin-react-hooks` and `globals`: hook rules and browser globals for the
  shared flat ESLint config.
- `@fontsource-variable/archivo`: the Archivo variable font, self-hosted.

Other choices:

- **Self-hosted font.** Vite bundles the `wdth.css` entry (width and weight axes)
  as hashed woff2 files, so no request leaves the origin and the CSP stays
  `'self'`.
- **Stub `fetch`, no MSW.** `createApi` takes a `fetch` option. Tests pass a
  route-table stub (`stubFetch`) that records requests. No service worker or
  network interception layer is needed.
- **Same-origin `/api`.** The SPA calls `/api/v1/...` only. Vite proxies `/api` to the
  gateway in development (stripping the prefix), nginx does the same in the
  container, and Traefik routes `/api/*` to the gateway in the cluster. No
  absolute gateway URL is in the bundle, and no CORS is needed.

## Alternatives

- **MSW**: realistic, but adds a dependency, a service worker and setup for what a
  small fetch stub covers.
- **Google Fonts CDN**: simpler import, but needs `font-src`/`style-src` exceptions in
  the CSP and leaks visitor IPs to a third party.
- **Absolute gateway URL with CORS**: bakes an environment into the bundle and
  widens the gateway's attack surface.

## Trade-off

A hand-written fetch stub does not exercise real HTTP behavior (redirects, streaming)
and each test lists its routes. That is acceptable: the contract tests cover the
wire, and the SPA only makes plain JSON calls. Self-hosting the font adds about
210 kB of woff2 to the build in exchange for a strict CSP.

# Dashboard MVP

**Initiative:** hub-dashboard-and-lifecycle
**Milestone:** 1/4

## What

Stand up `apps/dashboard` (Vite + React + TypeScript). Hub serves the built static assets at `/dashboard/*`. MVP scope: a status panel rendering the `/status` payload human-legibly, plus a single live book ticker for one selected symbol via WS gateway subscribe.

## References

- DEC-025 (dashboard as production-foundation surface, served by hub)
- DEC-026 (HTTP poll + WS subscribe data plane)
- DS-OPERATOR-USABILITY

## Approach

- `apps/dashboard` — Vite + React + TypeScript SPA. `vite build` outputs to `apps/dashboard/dist/`.
- `vite.config.ts` sets `base: '/dashboard/'` so all asset URLs resolve under that path.
- `apps/hub` adds `@fastify/static` registration during bootstrap, serving `apps/dashboard/dist/` at the `/dashboard` URL prefix.
- Dev: `pnpm --filter @silver8/dashboard dev` runs Vite at :5173 with a proxy to the hub at :3000 for `/status` and `/mcp`. WS connections go directly to ws://localhost:3001/.
- Prod: `pnpm build` builds dashboard + hub, hub serves dashboard static. `Dockerfile` updated to copy dashboard dist into the runtime image.

Two components:
- `StatusPanel` — polls `/status` every 1.5s; renders connections, upstream, per-topic state.
- `BookTicker` — symbol picker; opens WS, subscribes to `market://coinbase/book/<symbol>`, renders best bid/ask + spread + top-5 levels per side.

No external UI library — minimal hand-rolled CSS for clarity. Production dashboard would adopt a component library; MVP scope is "real foundation, minimal chrome."

## Tests

- Lightweight: render-smoke for both components with mocked fetch / WS.
- E2E verified by booting the hub and loading `/dashboard` in a browser (manual smoke; full e2e in M4).

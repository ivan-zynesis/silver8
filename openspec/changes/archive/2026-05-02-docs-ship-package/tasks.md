# Tasks — docs-ship-package

- [x] `docs/00-overview.md` — purpose, scope, non-goals
- [x] `docs/01-getting-started.md` — env vars, both transports, smoke checks
- [x] `docs/02-mcp-tool-reference.md` — all 5 tools with args, returns, examples, errors
- [x] `docs/03-mcp-resources.md` — URI scheme, resources/subscribe lifecycle, drain hint
- [x] `docs/04-topics.md` — book schema, cadence, real example, sorting guarantees
- [x] `docs/05-worked-examples.md` — 7 end-to-end scenarios for an LLM agent
- [x] `docs/06-failure-modes.md` — every event/error + recovery
- [x] `docs/07-ws-gateway.md` — WS protocol op/event reference + idempotency + backpressure
- [x] `docs/08-architecture.md` — one-page architecture write-up
- [x] `README.md` — quick-start + architecture-at-a-glance + layout
- [x] `Dockerfile` — multi-stage, distroless final
- [x] `docker-compose.yml` — single-container local dev with stop_grace_period > drain deadline
- [x] `.dockerignore`

## Verification

- `pnpm vitest run` → 11 files, 89 tests passed.
- `npx tsc -b apps/hub` → clean build.
- All docs present and cross-linked.

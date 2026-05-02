# Tasks — core-seams-nestjs-skeleton

- [x] Repo root configs (package.json, pnpm-workspace.yaml, turbo.json, tsconfig.base.json, .nvmrc)
- [x] `packages/core` — interfaces, types, errors
- [x] `packages/core-memory` — InMemoryBus (async, microtask-queued, lossy, demand-observable)
- [x] `packages/core-memory` — InMemoryOrderBookStore (snapshot+update, top-N reads, stale flag)
- [x] `packages/core-memory` — InMemoryRegistry (refcount, single-cleanup-path, demand emit)
- [x] `packages/observability` — Pino logger factory + Prometheus registry/metrics
- [x] Stub modules: `packages/ingestion`, `packages/gateway-ws`, `packages/mcp-server`
- [x] `apps/hub` — NestJS bootstrap, ConfigModule (@Global), three-mode composition root
- [x] HTTP shell: `/healthz`, `/readyz`, `/metrics`, `/status` (status payload from registry+store)
- [x] SIGTERM drain hook scaffold (ShutdownService with Drainable contract)
- [x] Bus semantics tests (11 tests, vitest)
- [x] Registry tests (churn 10k, storm 5k, idempotency, status reporting; 11 tests)
- [x] OrderBookStore tests (snapshot/update/stale/out-of-order; 8 tests)
- [x] Env loader tests (7 tests)

## Verification

- `pnpm vitest run` → 4 files, 37 tests passed.
- `npx tsc -b apps/hub` → clean build.
- `MODE=ingestion` and `MODE=gateway` boot fail with documented `CompositionError` (DEC-016 enforced).
- `MODE=monolith HTTP_PORT=3010` boots, all 4 endpoints respond correctly, SIGTERM exits cleanly.


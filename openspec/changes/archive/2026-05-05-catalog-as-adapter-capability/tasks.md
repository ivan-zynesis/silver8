# Tasks — catalog-as-adapter-capability

## Core types

- [ ] `packages/core/src/types.ts` — add `TopicDescriptor` and `VenueAdapterCatalog` interfaces. Re-export from package index.

## CoinbaseAdapter — hardcoded catalog (DEC-031)

- [ ] `packages/ingestion/src/coinbase/coinbase-catalog.ts` — new file: export `COINBASE_DEFAULT_SYMBOLS` constant + a helper that builds `TopicDescriptor[]` from a symbol list.
- [ ] `packages/ingestion/src/coinbase/coinbase.adapter.ts` — implement `VenueAdapterCatalog`: `listCatalog()`, `describeCatalogEntry(uri)`, `catalogReady` (synchronously true).
- [ ] `packages/ingestion/` bootstrap module — populate `CoinbaseAdapterConfig.symbols` from `COINBASE_DEFAULT_SYMBOLS` instead of env var.
- [ ] `apps/hub/src/config/` (or wherever the env schema lives) — remove `COINBASE_SYMBOLS` from production env schema. Confirm no docs reference it (update `docs/00-overview.md` etc. if so).

## Status surface (DEC-032)

- [ ] `apps/hub/src/http/status.controller.ts` (`buildStatus`) — rename `topics` → `active`; add `catalog` populated from adapter's `listCatalog()`.
- [ ] `packages/mcp-server/src/status-builder.ts` (`buildMcpStatus`) — same rename + addition; payload parity with HTTP.
- [ ] Update `HubStatus` interface (and any TS types it's referenced from) accordingly.

## MCP grounding (DEC-015 augmented)

- [ ] `packages/mcp-server/src/tools.ts` — replace `ToolDeps.configuredSymbols` with a `catalog: VenueAdapterCatalog` dep (or equivalent). `listConfiguredTopics` becomes a thin call to `catalog.listCatalog()`. Move `TopicDescriptor` import to core.
- [ ] `packages/mcp-server/src/mcp-server.service.ts` — wire the adapter (or a catalog port) into `toolDeps`. Remove `McpServerConfig.symbols` if it becomes redundant.
- [ ] `describeTopic()` — validate against `catalog.describeCatalogEntry(uri)` rather than `configuredSymbols.includes(symbol)`.

## WS gateway catalog enforcement (DEC-030)

- [ ] `packages/gateway-ws/src/ws-gateway.service.ts` (`handleSubscribe`) — after `parseResourceUri()`, call `catalog.describeCatalogEntry(uri)`; if undefined, send `{ event: 'error', code: 'unknown_topic', message, id? }` using `UnknownTopicError` from core for the message.
- [ ] Inject the catalog port into `WsGatewayService` (NestJS provider wiring at the gateway-ws module level).

## Readiness gate (DEC-033)

- [ ] `apps/hub/src/readiness/` (or wherever components are declared) — declare a new `'ingestion.catalog'` component, set ready when adapter reports `catalogReady === true`. For the v1 hardcoded source this happens at construction; the wiring should still go through `ReadinessReporter.set()` to keep the contract honest.

## Dashboard (DEC-032)

- [ ] `apps/dashboard/src/types.ts` — rename `topics` → `active`; add `catalog: TopicDescriptor[]` (or matching shape) on the status type.
- [ ] `apps/dashboard/src/App.tsx` — read symbol list from `status.catalog.map(t => t.symbol)` instead of `status.upstream.coinbase.symbols`. Sort/dedupe if multiple catalog entries share a symbol (defensive; today they won't).

## Tests

- [ ] `packages/ingestion/coinbase.adapter.test.ts` — `listCatalog()` returns expected shape for default symbols; `describeCatalogEntry()` returns descriptor for known URI; `undefined` for unknown URI; `catalogReady` true at construction.
- [ ] `packages/gateway-ws/ws-gateway.test.ts` — subscribe to `market://coinbase/book/UNKNOWN-USD` produces `{ event: 'error', code: 'unknown_topic', ... }` with available URIs enumerated; subscribe to a catalog URI still works.
- [ ] `packages/mcp-server/status-builder.test.ts` — built payload includes `catalog` (length matches default symbol count, kind `'book'`, venue `'coinbase'`) and `active` (subscribed-only, same shape as previous `topics`).
- [ ] `packages/mcp-server/tools.test.ts` — `list_topics` returns adapter catalog entries; `describe_topic` for unknown symbol returns the same actionable error with available list.
- [ ] `apps/hub/readiness.test.ts` (or wherever readiness wiring is tested) — readiness includes a `'ingestion.catalog'` component; component flips ready on adapter signal.
- [ ] `apps/integration-tests` — verify `/status.catalog` is populated immediately after hub boot (before any consumer subscribes); `/status.active` starts empty in demand-driven mode.

## Smoke

- [ ] Boot hub locally (default monolith mode). Verify:
  - `curl /status` shows non-empty `catalog`, empty `active`.
  - `curl /readyz` returns 200 only after catalog is populated (will be ~immediate).
  - WS client subscribe to `market://coinbase/book/BTC-USD` succeeds; subscribe to `market://coinbase/book/FAKE-USD` is rejected with `unknown_topic`.
  - Dashboard at `/dashboard` renders the symbol picker populated from catalog.
- [ ] Cleanup: docs sweep — `docs/00-overview.md`, `docs/02-mcp-tool-reference.md`, `docs/06-failure-modes.md` updated to mention catalog vs active and the `unknown_topic` error.

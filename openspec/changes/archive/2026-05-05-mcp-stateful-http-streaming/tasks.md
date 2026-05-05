# Tasks — mcp-stateful-http-streaming

## Core

- [x] `apps/hub/src/config/env.ts` — added `MCP_SESSION_IDLE_MS` (`z.coerce.number().int().nonnegative().default(300_000)`).
- [x] `apps/hub/src/modes/monolith.module.ts` — passes `sessionIdleMs` to `McpServerModule.forRoot`.
- [x] `packages/mcp-server/src/config.ts` — `McpServerConfig` gains `sessionIdleMs: number`.
- [x] `packages/mcp-server/src/mcp-consumer-handle.ts` (new) — implements `ConsumerHandle`. Forwards `BusMessage` as `notifications/resources/updated`; handles `rebalance` ConsumerEvent via `notifications/silver8/rebalance`. Handle is created before the per-session `McpServer`; `attachSessionId` and `attachServer` resolve the bootstrap circularity.
- [x] `packages/mcp-server/src/mcp-server.service.ts`:
  - `createSessionServer(handle): SessionServer` factory. Registers tools + resources; sets request handlers for `SubscribeRequestSchema` / `UnsubscribeRequestSchema` that go through `Registry` + `Bus`. Per-URI `Unsubscribe` map attached to the server (`__busOff`) for cleanup.
  - `cleanupSessionServer(server)` releases bus subs.
  - `setSessionRegistry(registry)` lets the controller expose its session map for drain.
  - Drain method: stdio sends rebalance over the singleton; HTTP iterates sessions, broadcasts rebalance, force-closes after deadline.
  - Deleted `createPerRequestServer`, `markSubscribed`, `markUnsubscribed`, `subscribedUris`, `busSubs`.
  - Stdio path uses `wireStdioSubscriptions(server)` (eager bus subscription on all catalog URIs); HTTP path is fully lazy / per-session.
- [x] `apps/hub/src/http/mcp.controller.ts`:
  - Per-session `Map<sessionId, McpSession>`.
  - On request: route by `Mcp-Session-Id` header; `isInitializeRequest` opens a fresh session via `sessionIdGenerator` + `onsessioninitialized` (registers consumer + session) + `onsessionclosed`.
  - `transport.onclose` → `dropSession`.
  - Idle reaper (`setInterval(60_000, .unref)`) closes sessions older than `sessionIdleMs`.
  - `onModuleDestroy`: clears interval, drops all sessions.

## Tests

- [x] `apps/integration-tests/src/lifecycle.test.ts` — new test 5: HTTP MCP `initialize` → captures session id → opens GET SSE → POSTs `resources/subscribe BTC-USD` → asserts at least one `notifications/resources/updated` arrives over SSE within 20s.
- [x] `apps/integration-tests/src/helpers.ts` — added `mcpInitialize`, `mcpPost`, `mcpDelete`, `mcpOpenSseStream` (raw fetch + manual SSE parser; no SDK client dep).

## Smoke

- [x] Test 5 IS the smoke: real HTTP, real SSE, real upstream feed → notifications observed end-to-end. Replaces a manual curl run.
- [x] Stdio path remains: `wireStdioSubscriptions` is the only wiring on the singleton when `transport === 'stdio'`; the controller is `MCP_TRANSPORT='http'` only.

## Verification

- [x] `pnpm -r build` — clean.
- [x] `pnpm -r typecheck` — clean.
- [x] `pnpm -r test` — 122/122 unit tests pass.
- [x] `pnpm test:ci-e2e` — 5/5 ✓ (test 5 added; total 7.4s).

## Docs

- [x] `docs/03-mcp-resources.md` — replaced "Stateless HTTP transport caveat" with "Stateful HTTP transport (DEC-035)" — full wire-flow walkthrough (initialize → SSE → subscribe → updates → cleanup).
- [x] `docs/06-failure-modes.md` — added "MCP HTTP session reaped" entry: 5-min idle TTL, 404 on stale session id, re-init guidance.
- [x] `apps/integration-tests/README.md` — listed test 5 in "What it covers".

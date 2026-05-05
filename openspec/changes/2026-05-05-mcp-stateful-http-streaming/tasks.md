# Tasks — mcp-stateful-http-streaming

## Core

- [ ] `apps/hub/src/config/env.ts` — add `MCP_SESSION_IDLE_MS` (`z.coerce.number().int().nonnegative().default(300_000)`).
- [ ] `apps/hub/src/modes/monolith.module.ts` — pass `mcpSessionIdleMs` to `McpServerModule.forRoot`.
- [ ] `packages/mcp-server/src/config.ts` — `McpServerConfig` gains `sessionIdleMs: number`.
- [ ] `packages/mcp-server/src/mcp-consumer-handle.ts` (new) — implements `ConsumerHandle`. Forwards `BusMessage` as `notifications/resources/updated`; handles `rebalance` ConsumerEvent via `notifications/silver8/rebalance`.
- [ ] `packages/mcp-server/src/mcp-server.service.ts`:
  - Add `createSessionServer(handle: McpConsumerHandle): McpServer` factory. Registers tools + resources (existing helpers), sets request handlers for `SubscribeRequestSchema` / `UnsubscribeRequestSchema` that go through `Registry` + `Bus`. Stores per-URI `Unsubscribe` map on the server for cleanup.
  - Delete `createPerRequestServer()`.
  - Delete `markSubscribed` / `markUnsubscribed` (registry now owns it).
  - Drain method delegates to controller's session-map walk (or accept session-snapshot accessor).
  - Stdio bootstrap path stays — singleton with `subscribe: true` capability, `wireResourceSubscriptions` continues to work for stdio.
- [ ] `apps/hub/src/http/mcp.controller.ts`:
  - Replace per-request server with per-session map.
  - On request: read `Mcp-Session-Id` header. If known → `transport.handleRequest`, update `lastActivity`. If unknown + `isInitializeRequest(body)` → create transport with `sessionIdGenerator`, `onsessioninitialized`, `onsessionclosed`; create handle + server via factory; `Registry.registerConsumer(handle)`; `server.connect(transport)`; `transport.handleRequest`. Else → 400.
  - `transport.onclose` → `dropSession(id)`.
  - `setInterval(60_000)` reaper — closes sessions with `Date.now() - lastActivity > sessionIdleMs`.
  - Expose `snapshotSessions()` and `sessionCount()` for the service's drain method.
  - On `onModuleDestroy`: clear reaper interval, drop all sessions.

## Dead code / cleanup

- [ ] Remove the 503 "MCP server is not loaded" branch's `markSubscribed`/`markUnsubscribed` references if present.
- [ ] `wireResourceSubscriptions` on the singleton — keep, but make it a no-op when `transport === 'http'` so stdio path remains correct without touching HTTP semantics.

## Tests

- [ ] `apps/integration-tests/src/lifecycle.test.ts` — new test 5: HTTP MCP `initialize` → capture session id → `resources/subscribe BTC-USD` → open SSE on same session → simultaneously a WS-gateway subscriber drives upstream attach → assert at least one `notifications/resources/updated` arrives over SSE within a deadline.
- [ ] (optional, time permitting) Unit test on the session-map semantics: create / reuse / reap-on-idle / reap-on-close / drain-broadcasts. Could live alongside `mcp-server`'s existing tests.

## Smoke

- [ ] Boot hub with `MCP_TRANSPORT=http` (default). Run the curl sequence in proposal.md "Smoke" section. Verify the SSE stream produces at least one `notifications/resources/updated` after a separate WS client subscribes to the same URI (driving upstream activity).
- [ ] Boot hub with `MCP_TRANSPORT=stdio`. Verify a stdio MCP client (e.g. MCP Inspector) can still call tools and subscribe — singleton path unchanged.

## Verification

- [ ] `pnpm -r build` — clean.
- [ ] `pnpm -r typecheck` — clean.
- [ ] `pnpm -r test` — unit suite still 122/122 (any new unit tests bump the count).
- [ ] `pnpm test:ci-e2e` — 5/5 ✓ (test 5 added).
- [ ] `pnpm test:e2e` — 5/5 ✓.

## Docs

- [ ] `docs/02-mcp-tool-reference.md` (or `03-mcp-resources.md`) — document the resources/subscribe flow with a worked example.
- [ ] `docs/06-failure-modes.md` — note "session reaped after 5 min idle; client gets transport close, expected to re-init". Operator-facing.
- [ ] `apps/integration-tests/README.md` — list test 5 in "what it covers".

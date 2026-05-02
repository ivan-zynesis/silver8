# Tasks — mcp-server

- [x] Tools: list_topics, describe_topic, get_top_of_book, get_book_snapshot, get_hub_status — Zod-typed with LLM-legible descriptions
- [x] Resources: register per-symbol book resource at `market://coinbase/book/<symbol>`; read returns BookView (or stale placeholder pre-snapshot)
- [x] Resources/subscribe wiring: server capability advertised; bus subscriptions emit `notifications/resources/updated` for active subscriptions
- [x] StdioTransport binding (auto-connect when MCP_TRANSPORT=stdio)
- [x] StreamableHTTPServerTransport mounted as a Fastify @All('/mcp') route in apps/hub (stateless mode: per-request transport)
- [x] Drainable: emits `notifications/silver8/rebalance` via server, gracefully skips "Not connected" in stateless HTTP mode
- [x] Readiness: declares `mcp-server`; flips ready after transport binding
- [x] Status parity: `buildMcpStatus` uses the same shape as the HTTP /status payload (DEC-022)
- [x] McpServerModule.forRoot replaces M1 stub; marked global
- [x] Tests: tool functions (validation, happy path, actionable errors) — 10 tests
- [x] Tests: status builder parity — 3 tests

## Verification

- `pnpm vitest run` → 11 files, 89 tests passed.
- Live MCP/HTTP smoke (curl):
  - `initialize` returns capabilities `{tools, resources: {subscribe: true}}`.
  - `tools/list` returns all 5 tools with full schemas + descriptions.
  - `tools/call list_topics` returns 3 topics (BTC-USD, ETH-USD, SOL-USD).
  - `tools/call get_top_of_book` with `BTC-USDT` returns LLM-actionable error: `unknown symbol; available: BTC-USD, ETH-USD, SOL-USD`.

## Deferred

- Resource read content updates currently emit on EVERY bus event for an active subscription (no de-duplication). Production might coalesce within a window. Not a correctness issue.


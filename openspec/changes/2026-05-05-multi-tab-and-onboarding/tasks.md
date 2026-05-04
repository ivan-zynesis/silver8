# Tasks — multi-tab-and-onboarding

## /status `mcp` block (DEC-022 evolution)

- [ ] `packages/mcp-server/src/status-builder.ts` — extend `McpHubStatus` and `StatusBuilderOptions` with optional `mcp: { transport, path }`. `buildMcpStatus` passes it through.
- [ ] `packages/mcp-server/src/mcp-server.service.ts` — `buildStatus()` populates the `mcp` block from `this.config` (transport, httpPath).
- [ ] `apps/hub/src/http/status.controller.ts` — inject `McpServerService` as `@Optional()`. Add `mcp` to `HubStatus` interface. Pass `{ transport, path }` through `buildStatus` so the HTTP payload includes the same block.

## Shared WebSocket connection (dashboard)

- [ ] `apps/dashboard/src/api/gateway-connection.tsx` — new file:
  - `GatewayConnectionContext` (React context).
  - `GatewayConnectionProvider({ port, children })` — owns one WS, exposes `subscribe(uri, listener) → unsubscribe()` API. Internal refcount per URI; sends WS `subscribe` op only on first listener for that URI; sends `unsubscribe` op only when the last listener leaves.
  - `useGatewayConnection()` hook returns the context.
- [ ] `apps/dashboard/src/api/use-book.ts` — refactor `useBookSubscription` to consume the shared connection rather than opening its own WS. Public return shape unchanged (`{ view, connection, lastNotice }`). `connection` reflects the shared connection's state, not a per-hook state.
- [ ] `apps/dashboard/src/main.tsx` — wrap `<App />` in `<GatewayConnectionProvider port={3001}>` (port can be derived from `window.location` for production-served dashboard; default 3001 for dev).

## Multi-tab BookTicker

- [ ] `apps/dashboard/src/components/TickerTabs.tsx` — new component:
  - Local state: `tabs: Array<{ id: string, symbol: string }>`, `activeTabId: string | null`.
  - Renders the catalog `SymbolPicker` as a "+ open tab" affordance (selecting a symbol creates a new tab).
  - Renders a horizontal tab bar with `[symbol]` chips and a × per tab.
  - Renders `BookTicker` for the active tab; subscription lives via `useBookSubscription(uri)` per-tab even when not active (so /status reflects the multi-sub state).
- [ ] `apps/dashboard/src/components/BookTicker.tsx` — minor: hide its own picker UI when used inside tabs. (Keep current behavior for backward compat or consolidate.)
- [ ] `apps/dashboard/src/App.tsx` — replace single SymbolPicker + BookTicker with `<TickerTabs>`. Keep `<StatusPanel>` above and `<McpOnboarding>` below.

## MCP onboarding panel

- [ ] `apps/dashboard/src/components/McpOnboarding.tsx` — new component:
  - Reads `status.mcp` from `useStatus()`.
  - Renders both transport snippets. Active transport (`status.mcp.transport`) gets the headline badge + copy-to-clipboard button. Inactive transport is shown informationally with the `MCP_TRANSPORT=...` env-var instruction.
  - HTTP snippet's URL composed from `window.location.host` + `status.mcp.path`.
  - Stdio snippet uses an example `command: node, args: [...path], env: { MCP_TRANSPORT: 'stdio' }`.
- [ ] `apps/dashboard/src/types.ts` — add `mcp` to `HubStatus`.
- [ ] `apps/dashboard/src/styles/global.css` — small additions: `.tabs`, `.tabs__chip`, `.tabs__chip--active`, `.tabs__close`, `.snippet`, `.snippet--inactive`, `.copy-button`.

## Cleanup

- [ ] `docker-compose.yml` — remove the leftover `COINBASE_SYMBOLS` env var (dead since DEC-031 hardcoded the catalog).

## Tests

- [ ] `packages/mcp-server/src/status-builder.test.ts` — assert `mcp` block appears in payload when `opts.mcp` is provided; absent otherwise.
- [ ] `apps/dashboard` — unit test for the gateway connection refcount. Two subscribes to the same URI → one `subscribe` op observed on the test WS; first unsubscribe → no `unsubscribe` op; second unsubscribe → `unsubscribe` op sent. Use a fake-WebSocket double or vitest mock.

## Smoke (manual)

- [ ] Boot hub locally. View `/status` — confirm new `mcp.transport` and `mcp.path` fields are populated.
- [ ] Open dashboard. Open three tabs (e.g. BTC-USD, ETH-USD, ETH-USD again). Confirm `/status.consumers.ws=1`, `totalSubscriptions=2`, two `active` entries with `consumerCount=1` each.
- [ ] Close one ETH-USD tab — verify other ETH-USD tab still receives updates; `active` length unchanged. Close the last ETH-USD tab — verify the symbol leaves `active` (DEC-027 channel unsub).
- [ ] Open another browser window of the dashboard. Subscribe to BTC-USD there. Verify `/status.consumers.ws=2` and `active[BTC-USD].consumerCount=2` (refcount across consumers).
- [ ] MCP onboarding panel: confirm correct `ACTIVE` badge for default `MCP_TRANSPORT=http`. Copy the snippet and use it from `~/Library/Application Support/Claude/claude_desktop_config.json` (or curl-equivalent against the URL) — verify the connection succeeds.

## Docs

- [ ] `docs/01-getting-started.md` — small note that the dashboard exposes an MCP onboarding section showing the current hub's connect-snippet.
- [ ] `docs/08-architecture.md` (if it documents `/status`) — add the `mcp` block to the schema sketch.

# Multi-Tab Book Ticker + MCP Onboarding Panel

**Initiative:** dashboard-validation-tools
**Milestone:** 1/1

## What

Two operator-validation tools for the dashboard, plus a tiny additive `/status` extension that supports them:

1. **In-app tabs on the book ticker.** One dashboard window subscribes to N URIs over a single WebSocket connection — the gateway protocol's subscription multiplexing rendered visible. Operators add/close tabs from the picker; closing the last tab on a symbol unsubscribes from the gateway (the demand-driven lifecycle becomes visually testable).

2. **MCP onboarding panel.** Copy-paste Claude Desktop config snippets for both stdio and HTTP+SSE transports. The hub's currently-active transport renders as the headline copy-paste-ready snippet; the inactive transport is shown informationally with the env-var instruction to switch. Snippet contents are driven by `/status.mcp` so they stay truthful as configuration changes.

3. **`/status` gains an `mcp` block.** Additive only: `mcp: { transport: 'http' | 'stdio', path: string }`. HTTP `/status` and MCP `get_hub_status` keep payload parity (DEC-022 augmented, not invalidated).

## References

- DS-OPERATOR-USABILITY (primary — both items pull on this)
- DS-BRIEF (10-minute walkthrough; this is what the operator demos)
- DS-MCP (onboarding panel surfaces MCP-specific config)
- DEC-014 — MCP Dual Transport (the snippets reflect this)
- DEC-022 — Status Surface (augmented additively with `mcp`)
- DEC-025 — Dashboard as Production-Foundation Surface
- DEC-026 — Dashboard Data Plane (HTTP poll + WS subscribe; unchanged)
- DEC-027 — Demand-Driven Upstream Lifecycle (the behavior tabs reveal)
- DEC-030 — Topic Catalog (the picker is already catalog-grounded)

## Approach

### Status surface — `mcp` block (DEC-022 evolution)

Add to the shared `McpHubStatus` payload and the HTTP `HubStatus`:

```ts
mcp: { transport: 'http' | 'stdio', path: string }
```

For `transport='http'` the path is the configured `httpPath` (default `/mcp`). For `transport='stdio'` the path field is omitted or empty — there is no HTTP path. The dashboard reads this to decide which snippet is active.

Wiring:
- `McpServerService.buildStatus()` populates the block from its own `config`.
- HTTP `StatusController` injects `McpServerService` (already global) as `Optional`; if present, passes its `config` into `buildStatus()` via a new `mcp` arg in `StatusBuilderOptions`.

### Shared WebSocket connection

Today's `useBookSubscription(uri)` opens a fresh WS per call. For one-WS-many-subscriptions (Scenario A from explore), we introduce a shared connection:

```
┌─ GatewayConnectionProvider (one WS for the dashboard) ─┐
│                                                        │
│  state machine: idle → connecting → open → closed      │
│  internal map<uri, Set<callback>>                      │
│                                                        │
│  subscribe(uri, cb): refcount++; if first, send op     │
│  unsubscribe(uri, cb): refcount--; if last, send op    │
│                                                        │
│  on inbound message: dispatch to listeners for that uri│
└────────────────────────────────────────────────────────┘
        ▲                                ▲
        │                                │
   useBookSubscription(uri)        useBookSubscription(uri)
        ▲                                ▲
        │                                │
    Tab "BTC-USD"                     Tab "ETH-USD"
```

Refcounting in the provider matches the gateway's own server-side
behavior (idempotent subscribe). When two UI tabs subscribe to the
same symbol, the dashboard sends one `subscribe` op; closing one tab
keeps the subscription alive for the other.

### Multi-tab BookTicker

A new `TickerTabs` component owns:
- `tabs: Array<{ id: string, symbol: string }>` — UI tabs, one per "browser tab" in our paradigm.
- `activeTabId: string | null` — which tab's content is rendered.

Actions:
- **Add tab**: triggered by selecting a catalog symbol from the picker. Creates a new tab, makes it active, drives a subscribe via the shared connection.
- **Close tab**: removes the tab, unsubscribes the shared connection if no other tab uses that URI.
- **Switch tab**: changes which BookTicker is rendered. Subscriptions for inactive tabs stay alive — that's the point. Only the active tab is visually rendered (DOM efficiency); the WS subscription persists so /status reflects the multi-subscription state.

The existing `BookTicker.tsx` is reused per-tab. The catalog-driven `SymbolPicker` becomes the "open new tab" trigger.

### MCP onboarding panel

```
┌── MCP Onboarding (component) ─────────────────────────┐
│  reads status.mcp                                     │
│                                                       │
│  if transport === 'http':                             │
│    [HTTP+SSE ▸ ACTIVE]    Claude Desktop snippet      │
│                           url: http://<host>:<port><path>
│                           [copy]                      │
│                                                       │
│    [stdio ▸ alternative]  Claude Desktop snippet      │
│                           command: node, args: [...]  │
│                           env: MCP_TRANSPORT=stdio    │
│                           Set MCP_TRANSPORT=stdio &   │
│                             restart to use this.      │
│                                                       │
│  if transport === 'stdio':  swap the badges           │
└───────────────────────────────────────────────────────┘
```

The HTTP snippet's `url` is `http://<window.location.host><status.mcp.path>` so it's truthful for whatever host/port the dashboard is loaded from.

The stdio snippet uses the canonical Node command pattern (`node /path/to/dist/main.js`) with `MCP_TRANSPORT=stdio` in env. Path is approximate by definition (the operator runs the binary wherever they checked it out) — the snippet is an example.

### Dashboard layout

```
┌─ Hub Status panel ────────────────────────────────┐
│  (existing)                                       │
└───────────────────────────────────────────────────┘
┌─ Ticker tabs ─────────────────────────────────────┐
│  [BTC-USD] [ETH-USD] [+]                          │
│  ──────────────────                               │
│  BookTicker for active tab                        │
└───────────────────────────────────────────────────┘
┌─ MCP onboarding ──────────────────────────────────┐
│  (new — described above)                          │
└───────────────────────────────────────────────────┘
```

### Cleanup

`docker-compose.yml` still has a leftover `COINBASE_SYMBOLS` env entry from before the catalog-as-adapter-capability milestone removed the variable. Remove it; it's silently ignored today but it's stale documentation.

## Implementation note (per-window scope)

Each browser tab/window opens its own WebSocket via the GatewayConnectionProvider — the dashboard does not pool WS connections across tabs/windows. This is intentional: it lets the operator demo the refcount-across-consumers story (Scenario B) by simply opening another browser window. The "in-app tabs share one WS" property holds per browser tab; the cross-tab/window behavior is by-design separate connections. Per the operator decision in explore, this is an implementation note, not an ADR.

## Tests

- `packages/mcp-server/status-builder.test.ts` — assert the `mcp` block is in the payload when an `mcp` option is passed; absent (or undefined) when omitted.
- `apps/dashboard` — light unit test for the gateway connection refcount: two subscribes to the same URI = one `subscribe` op sent; one unsubscribe leaves the subscription alive; second unsubscribe sends `unsubscribe`.
- Smoke: boot hub, open dashboard with three tabs (BTC-USD, ETH-USD, ETH-USD again — testing dedup), verify `/status.consumers.ws=1`, `totalSubscriptions=2`, `active.length=2` with consumerCount=1 each. Close one ETH-USD tab; the other ETH-USD remains. Close the last ETH-USD tab; channel unsubscribes upstream (DEC-027).
- Smoke: open another browser window; verify `/status.consumers.ws=2`. Subscribe to BTC-USD in the new window; verify `active[BTC-USD].consumerCount=2` (refcount across consumers).
- Smoke: MCP onboarding panel renders the correct active-transport badge (`http` by default); copying the snippet and using it from `claude_desktop_config.json` (or curl) successfully connects.

## Non-goals

- Per-consumer detail view in the dashboard.
- Connection event log.
- Message-rate graph / sparkline.
- Connection multiplexing across browser tabs/windows (each window stays its own WS — see implementation note above).
- Stdio path autodetection. The stdio snippet's `command/args` is a documentation example.
- Persisting tabs across page reloads. MVP scope.

## What's lost / migration notes

- `useBookSubscription`'s public API stays the same shape (`(uri) => { view, connection, lastNotice }`), but its internals change to consume the shared connection. Callers don't break.
- `docker-compose.yml`'s `COINBASE_SYMBOLS` line is dead; this change deletes it.
- Adds one Optional dependency on `McpServerService` from `StatusController`. In future `MODE=gateway`, that service is still present (gateway tier hosts MCP); in future `MODE=ingestion`, it isn't, hence Optional.

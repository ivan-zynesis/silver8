# Stateful HTTP Sessions for MCP

**Initiative:** mcp-streaming-over-http
**Milestone:** 1/1

## What

Replace the stateless per-request `McpServer` path with stateful sessions over HTTP. Re-enable `resources/subscribe` so HTTP MCP agents can stream `notifications/resources/updated` continuously over SSE — finishing what DEC-013 + DEC-014 originally committed and superseding the workaround landed in df290b4.

## References

- DEC-035 — Stateful HTTP Sessions for MCP (primary)
- DEC-013 — MCP Streaming via `resources/subscribe`
- DEC-014 — MCP Dual Transport (HTTP+SSE primary, stdio supported)
- DEC-019 — Graceful Drain via Rebalance Hint (drain iterates sessions)
- DEC-022 — Status Surface (consumers.mcp becomes session-aware)
- DEC-027 — Demand-Driven Upstream Lifecycle (MCP subs drive upstream same as WS)
- DS-MCP, DS-LLM-USABILITY, DS-OPERATOR-USABILITY

## Approach

### The `McpConsumerHandle`

Each session gets a handle implementing the existing `ConsumerHandle` interface — same shape that `WsConsumerHandle` already implements. This makes MCP sessions registry-symmetric with WS connections: they participate in `Registry.onDemandChange` events, drive the demand-driven upstream lifecycle (DEC-027), and aggregate into `/status.consumers.mcp` and `/status.active[].consumerCount` via the same code path.

```typescript
class McpConsumerHandle implements ConsumerHandle {
  readonly id: string;            // `mcp:${sessionId}`
  readonly surface = 'mcp';
  readonly connectedAt: string;

  constructor(private sessionId, private server, private transport) {}

  deliver(msg: BusMessage): SendResult {
    // Forward bus event as notifications/resources/updated.
    // MCP semantics: client re-reads the resource; we don't push the body.
    this.server.server.notification({
      method: 'notifications/resources/updated',
      params: { uri: msg.uri },
    }).catch(() => { /* transport gone */ });
    return { status: 'queued' };
  }

  sendEvent(event: ConsumerEvent): void {
    // rebalance hint already wires via the existing drain path's notification
    // call; per-resource events (stale/fresh/lagged) are coalesced into a
    // notifications/resources/updated so the client re-reads and sees the
    // new freshness state in the BookView payload.
    if (event.type === 'rebalance') {
      this.server.server.notification({
        method: 'notifications/silver8/rebalance',
        params: { reason: event.reason, deadlineMs: event.deadlineMs },
      }).catch(() => {});
    } else if ('uri' in event) {
      this.server.server.notification({
        method: 'notifications/resources/updated',
        params: { uri: event.uri },
      }).catch(() => {});
    }
  }

  disconnect(reason: string): void {
    this.transport.close().catch(() => {});
  }
}
```

### Session lifecycle

`McpController` keeps the session map; the controller is the single owner.

```typescript
interface McpSession {
  id: string;
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  handle: McpConsumerHandle;
  lastActivity: number;
}

private sessions = new Map<string, McpSession>();
```

Per request:

```
        ┌───────────────────────────────────────────────────────────┐
   ─→   │  read Mcp-Session-Id header                               │
        │  ┌─────────────────────────┬───────────────────────────┐  │
        │  │ has id, in map          │ no id                     │  │
        │  ├─────────────────────────┼───────────────────────────┤  │
        │  │ session.lastActivity =  │ if isInitializeRequest:   │  │
        │  │   Date.now()            │   create transport with   │  │
        │  │ transport.handleRequest │   sessionIdGenerator,     │  │
        │  │                         │   onsessioninitialized,   │  │
        │  │                         │   onsessionclosed         │  │
        │  │                         │   create server (factory) │  │
        │  │                         │   server.connect(transport)│  │
        │  │                         │   transport.handleRequest │  │
        │  │                         │ else:                     │  │
        │  │                         │   400 Bad Request         │  │
        │  └─────────────────────────┴───────────────────────────┘  │
        └───────────────────────────────────────────────────────────┘
```

Cleanup paths (all converge on `dropSession(id)`):

- `transport.onclose` — set when the transport is created. SDK calls this when client closes the SSE stream or DELETEs `/mcp`.
- `onsessionclosed` callback — SDK calls this on explicit DELETE.
- Idle reaper — single `setInterval(60_000)` scans `sessions`, closes any with `Date.now() - lastActivity > MCP_SESSION_IDLE_MS` (default `300_000`). The transport's `close()` triggers `onclose` → `dropSession`.
- Drain (SIGTERM) — iterates sessions, `handle.sendEvent({type:'rebalance', ...})`, waits the deadline, then `handle.disconnect()` for stragglers.

`dropSession(id)`:
- Unsubscribe all per-session bus listeners.
- `Registry.removeConsumer(handle.id)` — clears subscriptions, fires `onDemandChange` (last-consumer-out triggers upstream unsub via DEC-027).
- `server.close()`.
- Decrement `activeConsumerConnections{surface=mcp}` metric.
- Delete from `sessions` map.

### `createSessionServer()` factory on `McpServerService`

Builds a fresh `McpServer` configured with `resources: { subscribe: true }`, registers tools + resources via the existing `registerToolsOn` / `registerResourcesOn` helpers, then registers subscribe/unsubscribe request handlers that wire through the Registry + Bus.

```typescript
createSessionServer(handle: McpConsumerHandle): McpServer {
  const server = new McpServer(
    { name: 'silver8-market-data-hub', version: '0.1.0' },
    { capabilities: { tools: {}, resources: { subscribe: true, listChanged: false } } },
  );
  this.registerToolsOn(server);
  this.registerResourcesOn(server);

  const busOff = new Map<ResourceURI, Unsubscribe>();

  server.server.setRequestHandler(SubscribeRequestSchema, async (req) => {
    const uri = req.params.uri as ResourceURI;
    if (!this.catalog.describeCatalogEntry(uri)) {
      throw new UnknownTopicError(uri, this.catalog.listCatalog().map(t => t.uri));
    }
    if (busOff.has(uri)) return {};  // idempotent
    this.registry.subscribe(handle.id, uri);
    const off = this.bus.subscribe(uri, (msg) => handle.deliver(msg));
    busOff.set(uri, off);
    return {};
  });

  server.server.setRequestHandler(UnsubscribeRequestSchema, async (req) => {
    const uri = req.params.uri as ResourceURI;
    const off = busOff.get(uri);
    if (off) {
      off();
      busOff.delete(uri);
      this.registry.unsubscribe(handle.id, uri);
    }
    return {};
  });

  // Cleanup hook the controller calls on session drop.
  (server as McpServer & { __busOff: Map<ResourceURI, Unsubscribe> }).__busOff = busOff;
  return server;
}
```

Bus subscriptions are **lazy** (per-URI, on first subscribe) and **per-session**. Different from the singleton's eager-on-all-catalog-URIs approach. Fewer listeners, cleaner cleanup.

### `/status.consumers.mcp`

Already comes from `Registry.status()` → `consumersBySurface.mcp`. The new code path calls `Registry.registerConsumer(handle)` on session creation and `removeConsumer` on cleanup, so the count is automatic. Per-topic `consumerCount` aggregates correctly because `Registry.subscribe(handle.id, uri)` runs for every MCP subscribe — same path WS uses.

The pre-existing `markSubscribed`/`markUnsubscribed` methods on `McpServerService` (which only incremented a Prom metric without going through the registry) are removed — registry registration now does that work and more.

### Drain (DEC-019)

`McpServerService.drain(deadlineMs)` walks the controller's session map (passed in or accessed via injection):

```typescript
async drain(deadlineMs: number): Promise<void> {
  this.readiness.set(READINESS_KEY, false);
  const sessions = this.controller.snapshotSessions();
  for (const s of sessions) {
    s.handle.sendEvent({ type: 'rebalance', reason: 'shutdown', deadlineMs });
  }
  // Wait either until all sessions close or deadline.
  const start = Date.now();
  while (this.controller.sessionCount() > 0 && Date.now() - start < deadlineMs) {
    await new Promise(r => setTimeout(r, 100));
  }
  for (const s of this.controller.snapshotSessions()) {
    s.handle.disconnect('drain_timeout');
  }
}
```

The current `drain` in `McpServerService` sends a single notification on the singleton — that path is replaced.

### Dead code removal

- `createPerRequestServer()` factory — deleted.
- The `if (!this.transportClass) { ... }` and the `mcp.connect` call in `mcp.controller.ts` move into the per-session creation path.
- The "register a per-symbol resource at bootstrap" loop in the singleton's `wireResourceSubscriptions` — kept for stdio (which still uses the singleton). For HTTP, registration happens in the per-session factory.
- `markSubscribed` / `markUnsubscribed` on `McpServerService` — deleted.

### Env

`apps/hub/src/config/env.ts` gains `MCP_SESSION_IDLE_MS` (coerce, default `300_000`).

## Tests

- `apps/integration-tests/src/lifecycle.test.ts` — new **test 5**:
  ```
  test 5 — MCP HTTP session subscribes to a resource, hub publishes
            an update, client receives notifications/resources/updated.
  ```
  Uses native `fetch` against `/mcp` to send `initialize` (capture `Mcp-Session-Id` header), then `resources/subscribe`, then opens an SSE listener on the same session and waits for at least one `notifications/resources/updated` after a WS subscriber elsewhere has caused upstream activity. Same test runs under both bringup modes (DEC-029 docker, DEC-034 process).
- Unit-level: extend `apps/hub` unit tests OR `packages/mcp-server` to cover session map semantics — create-by-initialize, reuse-by-header, reap-on-idle, reap-on-close, drain-broadcasts-rebalance.

## Smoke

```bash
# initialize → captures Mcp-Session-Id
INIT=$(curl -sSi -X POST http://localhost:3000/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0.1"}}}')
SID=$(echo "$INIT" | grep -i 'mcp-session-id:' | awk '{print $2}' | tr -d '\r')

# subscribe
curl -sS -X POST http://localhost:3000/mcp \
  -H "Mcp-Session-Id: $SID" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"resources/subscribe","params":{"uri":"market://coinbase/book/BTC-USD"}}'

# open SSE — should receive notifications/resources/updated frames
curl -sS -N http://localhost:3000/mcp \
  -H "Mcp-Session-Id: $SID" \
  -H 'Accept: text/event-stream'
```

## Non-goals

- Session caps / per-session quota (operator confirmed: infinite in monolith mode).
- Auth / origin restrictions (out of scope; no DS-AUTH).
- Resumability (SDK supports `eventStore` but we don't need it; clients reconnect with a new session).
- Stateless mode coexistence — explicitly removed per DEC-035.
- Stdio path changes — completely untouched; still uses the singleton with subscribe-aware wiring.

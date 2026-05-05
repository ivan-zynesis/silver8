# MCP Resources

The hub registers one resource per configured symbol. Resources implement `resources/subscribe` for protocol-native streaming (DEC-013).

## URI scheme

```
market://<venue>/book/<symbol>
```

Examples:
- `market://coinbase/book/BTC-USD`
- `market://coinbase/book/ETH-USD`

The scheme is stable and forward-compatible: future kinds (e.g. `trades`) and venues plug into the same shape.

## Lifecycle

### 1. List

```json
{"jsonrpc":"2.0","id":1,"method":"resources/list"}
```

Returns one entry per configured symbol with `uri`, `name`, `mimeType: "application/json"`.

### 2. Read (point-in-time)

```json
{"jsonrpc":"2.0","id":2,"method":"resources/read","params":{"uri":"market://coinbase/book/BTC-USD"}}
```

Returns the current top-50 `BookView` as JSON. If no snapshot has arrived yet, returns a stale placeholder with `stale: true, staleReason: "awaiting initial snapshot"`.

### 3. Subscribe (streaming)

```json
{"jsonrpc":"2.0","id":3,"method":"resources/subscribe","params":{"uri":"market://coinbase/book/BTC-USD"}}
```

Server starts emitting `notifications/resources/updated` whenever the resource changes:

```json
{"jsonrpc":"2.0","method":"notifications/resources/updated","params":{"uri":"market://coinbase/book/BTC-USD"}}
```

After receiving the notification, call `resources/read` to fetch the current state. Most MCP clients automate the read step.

### 4. Unsubscribe

```json
{"jsonrpc":"2.0","id":4,"method":"resources/unsubscribe","params":{"uri":"market://coinbase/book/BTC-USD"}}
```

## Drain hint

On hub shutdown the server emits a custom notification:
```json
{"jsonrpc":"2.0","method":"notifications/silver8/rebalance","params":{"reason":"shutdown","deadlineMs":30000}}
```
Treat this as: *finish what you're doing, then reconnect*. See [`06-failure-modes.md`](06-failure-modes.md).

## Quick mental model

> **Subscribe to be told *when* something changes; read to get *what* changed.** The notification is small (just the URI); the content is fetched on demand. This keeps the protocol cheap and the consumer in control of how often it actually pulls the latest view.

## Stateful HTTP transport (DEC-035)

The HTTP transport runs in stateful mode: each MCP client gets a session, identified by the `Mcp-Session-Id` header that the server returns on `initialize`. Subscriptions live for the session, not for a single request — the same SSE stream delivers `notifications/resources/updated` for every URI the client has subscribed to.

Wire flow:

1. **Initialize** — `POST /mcp` with the `initialize` request (no header). The 200 response carries `Mcp-Session-Id: <uuid>`; remember it.
2. **Initialized notification** — `POST /mcp` with `{"jsonrpc":"2.0","method":"notifications/initialized"}` and the `Mcp-Session-Id` header. Per the MCP spec.
3. **Open the SSE stream** — `GET /mcp` with `Accept: text/event-stream` and the `Mcp-Session-Id` header. Server-initiated notifications flow on this long-lived connection.
4. **Subscribe** — `POST /mcp` with the `resources/subscribe` request and the `Mcp-Session-Id` header. The session is now registered as an MCP consumer (see [`08-architecture.md`](08-architecture.md)) and demand-driven upstream channel attach kicks in (DEC-027).
5. **Updates** — read `notifications/resources/updated` events from the SSE stream and call `resources/read` to fetch the latest `BookView`.
6. **Unsubscribe / close** — either send `resources/unsubscribe`, send `DELETE /mcp` to end the session, or just disconnect. Idle sessions reap automatically after `MCP_SESSION_IDLE_MS` (default 5 min).

A session that goes longer than the idle window without activity is closed by the server; the client should re-`initialize` and re-`subscribe`. There is no concurrent-session cap in monolith mode — the registry tracks them like any other consumer surface.

The WS gateway ([`07-ws-gateway.md`](07-ws-gateway.md)) remains the option for non-MCP streaming; the surfaces are symmetric (DEC-026) and you can mix and match per client.

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

## Stateless HTTP transport caveat

The hub's HTTP transport runs in stateless mode (one transport per request). `resources/subscribe` works for the duration of a connection but does not survive across requests — clients that want long-lived subscriptions over HTTP should use the SDK's session support (planned, not in v1) or use the stdio transport. The WS gateway ([`07-ws-gateway.md`](07-ws-gateway.md)) is the sturdier option for non-MCP streaming.

# WebSocket Gateway

A small JSON op protocol for non-MCP consumers. Same `market://` URIs as MCP; same fan-out from the same internal Bus.

## Connection

```
ws://localhost:3001/
```

No authentication, no path. Plain WebSocket.

## Client → server messages

| Op | Payload | Purpose |
|---|---|---|
| `subscribe` | `{op, resource, id?}` | Subscribe to a topic. Optional `id` is echoed in the ack for correlation. |
| `unsubscribe` | `{op, resource, id?}` | Unsubscribe. |
| `ping` | `{op, id?}` | Liveness check. Server replies with `pong`. |

Resources are full URIs: `market://coinbase/book/BTC-USD`.

## Server → client events

| Event | Payload | When |
|---|---|---|
| `ack` | `{event, op, resource, id?}` | Server accepted a subscribe / unsubscribe op. |
| `snapshot` | `{event, resource, data, sequence, stale}` | Initial state on subscribe; also after a stale recovery; `data` is a `BookView` with top-50 levels. |
| `update` | `{event, resource, data, sequence}` | Incremental change applied (data is the resulting top-50 view, not a delta). |
| `stale` | `{event, resource, reason}` | Topic entered stale state (sequence gap, heartbeat timeout). |
| `fresh` | `{event, resource}` | Topic recovered from stale; expect a fresh `snapshot` next. |
| `lagged` | `{event, resource, dropped}` | Per-consumer queue overflowed; `dropped` messages were evicted. Read faster or expect disconnect. |
| `rebalance` | `{event, reason, deadlineMs}` | Hub is draining (SIGTERM); reconnect to land on a non-draining instance. |
| `error` | `{event, code, message, id?}` | Op rejected or invalid. Codes: `protocol_error` (malformed JSON / op shape), `invalid_uri` (does not match `market://<venue>/<kind>/<symbol>`), `unknown_topic` (well-formed URI but not in the catalog — DEC-030; `message` enumerates available topics). |
| `pong` | `{event, id?}` | Reply to `ping`. |

## Lifecycle

1. Connect.
2. Send `subscribe` — receive `ack`, then `snapshot`.
3. Receive `update`s as the book changes.
4. (Optional) `unsubscribe` — receive `ack`. The topic stops emitting to your connection.
5. (Optional) Send another `subscribe` for a different topic.
6. On `rebalance`, finish your task, close, and reconnect.
7. On disconnect, reconnect — book state is rebuilt by re-subscribing.

## Idempotency

- `subscribe` to a topic you already subscribed to: ack is sent, no duplicate fan-out.
- `unsubscribe` for a topic you never subscribed to: ack is sent (no-op).

## Backpressure (DEC-011)

The server uses a bounded ring buffer per consumer (default depth 1000). If your client is too slow:

- Newest messages overwrite oldest; you'll see a `lagged` event with the cumulative drop count.
- If `socket.bufferedAmount` stays over watermark for `GATEWAY_OVERFLOW_DISCONNECT_MS` (default 5s), the server disconnects with `consumer_lagged`.

If you ever see a `lagged` event, your view of the book may be missing intermediate states — re-subscribing replays a fresh snapshot.

## Example session

```
> connect ws://localhost:3001/

← (open)

> {"op":"subscribe","resource":"market://coinbase/book/BTC-USD","id":"r1"}

← {"event":"ack","op":"subscribe","resource":"market://coinbase/book/BTC-USD","id":"r1"}
← {"event":"snapshot","resource":"market://coinbase/book/BTC-USD","data":{...},"sequence":4982371,"stale":false}
← {"event":"update","resource":"market://coinbase/book/BTC-USD","data":{...},"sequence":4982372}
← {"event":"update","resource":"market://coinbase/book/BTC-USD","data":{...},"sequence":4982373}
… …
← {"event":"stale","resource":"market://coinbase/book/BTC-USD","reason":"sequence_gap"}
… (1s later)
← {"event":"snapshot","resource":"market://coinbase/book/BTC-USD","data":{...},"sequence":4983001,"stale":false}
← {"event":"fresh","resource":"market://coinbase/book/BTC-USD"}

> {"op":"unsubscribe","resource":"market://coinbase/book/BTC-USD"}
← {"event":"ack","op":"unsubscribe","resource":"market://coinbase/book/BTC-USD"}
```

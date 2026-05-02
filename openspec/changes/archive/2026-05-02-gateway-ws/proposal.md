# WS Gateway with Bounded Backpressure + Drain

**Initiative:** market-data-hub
**Milestone:** 3/5

## What

Implement the WebSocket consumer surface. Accepts subscribe/unsubscribe op messages, registers consumers in the Registry, fans out Bus messages to subscribers with bounded backpressure, and supports protocol-level rebalance drain on SIGTERM.

## References

- DEC-011 (backpressure: bounded queue, drop-oldest, sustained-overflow disconnect)
- DEC-012 (gateway WS subscribe-op protocol)
- DEC-019 (graceful drain via rebalance hint)
- DEC-006 (Registry hazards — single-cleanup-path enforced via ConsumerHandle)

## Approach

### Wire protocol (DEC-012)

Client → server:
```json
{"op":"subscribe","resource":"market://coinbase/book/BTC-USD","id":"opt-correlation-id"}
{"op":"unsubscribe","resource":"market://coinbase/book/BTC-USD"}
{"op":"ping"}
```

Server → client:
```json
{"event":"ack","op":"subscribe","resource":"...","id":"..."}
{"event":"snapshot","resource":"...","data":{...},"sequence":N,"stale":false}
{"event":"update","resource":"...","data":{...},"sequence":N}
{"event":"stale","resource":"...","reason":"..."}
{"event":"fresh","resource":"..."}
{"event":"lagged","resource":"...","dropped":N}
{"event":"rebalance","reason":"...","deadlineMs":N}
{"event":"error","code":"...","message":"..."}
{"event":"pong"}
```

### Backpressure (DEC-011)

Per-consumer bounded ring buffer (default 1000). On enqueue:
- If full: drop oldest, mark `dropsSinceLastEmit++`, return `{status: 'dropped', queueDepth: N}`.
- If `socket.bufferedAmount > watermark`: count toward sustained-overflow timer.
- If sustained overflow exceeds threshold: emit `lagged` event with drop count, then `disconnect("consumer_lagged")`.

Serialize-once-fan-out-many: wire JSON computed once per Bus message, then `socket.send(buffer)` to each subscribed consumer.

### Drain (DEC-019)

`WsGateway` implements `Drainable`. On SIGTERM:
1. Stop accepting new connections.
2. Broadcast `{event:"rebalance", reason:"shutdown", deadlineMs:N}` to every connected consumer.
3. Wait up to `drainDeadlineMs` for consumers to disconnect on their own.
4. Force-close any remaining sockets.

## Tests

- BoundedQueue: enqueue/dequeue, drop-oldest on overflow, drop counting.
- Subscribe-protocol parser: valid/invalid messages, error responses.
- Gateway end-to-end via real WS pair: subscribe → snapshot delivered, update → fan-out, unsubscribe → quiet.
- Slow-consumer disconnect: simulate sustained over-watermark → consumer disconnected with lagged reason.
- Drain: send rebalance → consumers reconnect → server exits cleanly.

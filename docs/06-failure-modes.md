# Failure Modes

What you'll see when things go wrong, and what to do.

## Topic-level: stale

**Trigger.** Upstream sequence gap detected, OR no message from Coinbase within the heartbeat watchdog timeout (default 30s).

**Surface.**
- MCP: `get_top_of_book` / `get_book_snapshot` return `BookView` with `stale: true, staleReason: "sequence_gap" | "..."`. The values reflect the last known good snapshot.
- WS gateway: `{"event":"stale","resource":"...","reason":"..."}`.

**Hub response.** Automatic. The Coinbase adapter unsubscribes + resubscribes to the affected feed; on receipt of the fresh snapshot the topic transitions back to fresh.

**Your response.**
- If you can wait: do nothing. The topic recovers on its own (typically <1s).
- If you can't tolerate stale data: refuse to act on a stale `BookView` and retry the call after a short delay.

**Confirming recovery.**
- MCP: `book.fresh` is emitted internally; your next call returns `stale: false`.
- WS gateway: `{"event":"fresh","resource":"..."}` is emitted, followed by a fresh `snapshot` event.

---

## Consumer-level: lagged

**Trigger.** Your client isn't draining its connection fast enough. The hub's per-consumer ring buffer overflowed and dropped messages.

**Surface.**
- WS gateway: `{"event":"lagged","resource":"*","dropped":N}`. Subsequent messages may also be lost until you catch up.

**Hub response.** The hub starts a sustained-overflow timer. If your `bufferedAmount` stays over watermark for `GATEWAY_OVERFLOW_DISCONNECT_MS` (default 5s), the hub disconnects with reason `consumer_lagged`.

**Your response.**
- Read faster (drain the WS frame queue without delay).
- If you can't, **resync**: re-fetch the current snapshot for each subscribed topic via `get_book_snapshot` (MCP) or by waiting for the next `snapshot` event (the gateway sends one on subscribe).

---

## Connection-level: rebalance

**Trigger.** The hub received SIGTERM (autoscale-down or rolling deploy).

**Surface.**
- WS gateway: `{"event":"rebalance","reason":"shutdown","deadlineMs":N}`.
- MCP: custom notification `notifications/silver8/rebalance` with `{reason, deadlineMs}`.

**Hub response.** Stops accepting new connections, broadcasts the hint, waits up to `deadlineMs`, force-closes anything still attached.

**Your response.** Finish the in-flight operation, close the connection, reconnect — the LB routes you to a non-draining instance.

---

## Tool-call: unknown symbol

**Trigger.** You called `get_top_of_book` / `get_book_snapshot` / `describe_topic` with a symbol not in the configured list.

**Surface.**
```json
{"isError":true,"content":[{"type":"text","text":"unknown symbol BTC-USDT; available symbols: BTC-USD, ETH-USD, SOL-USD"}]}
```

**Your response.** Pick a symbol from the listed valid ones, or call `list_topics` to discover what's configured.

---

## Tool-call: no book state yet

**Trigger.** A snapshot for the requested symbol has not yet arrived. Common right after hub start.

**Surface.**
```json
{"isError":true,"content":[{"type":"text","text":"no book state yet for BTC-USD; the upstream feed has not delivered a snapshot. Try get_hub_status to inspect upstream connection state."}]}
```

**Your response.** Call `get_hub_status` to check `upstream.coinbase.status` and the topic's `lastTimestamp`. Wait briefly and retry.

---

## Hub-level: not ready

**Trigger.** `/readyz` returns `503` and `{"ready": false, "components": [{"component":"ingestion","ready":false}, ...]}`.

**Causes.**
- Hub just started; upstream snapshot not yet received.
- Upstream connection failing (firewall, bad URL).
- Hub is draining (`draining: true`).

**Your response.** Don't route consumer traffic to this instance. Watch `/readyz` until it flips to `200`.

---

## On restart: everything in-memory is lost

The hub is in-memory only (`OrderBookStore`, `Registry`, all WS sockets). On restart:

- All consumer connections drop. Clients reconnect via the LB.
- Books are rebuilt from a fresh Coinbase snapshot (~1s for active markets).
- `Registry` refcounts reset to zero.
- Recent message queues are gone (no replay).

**This is documented and expected.** The take-home brief explicitly asks for in-memory with documented loss-on-restart semantics.

---

## Upstream Coinbase quirks

- **Connection limits**: opening too many WS connections from one IP is rate-limited. The hub uses a single connection per process; horizontally scaling the monolith would multiply this. Production deployment uses split-tier with a singleton ingestion (DEC-016).
- **Sequence gaps**: rare but real. Handled (see "stale" above).
- **Quiet markets**: heartbeats on the `heartbeats` channel keep the connection alive even if a symbol isn't trading. If heartbeats stop too, the watchdog reconnects.

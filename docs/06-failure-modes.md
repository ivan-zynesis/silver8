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

**Trigger.** You called `get_top_of_book` / `get_book_snapshot` / `describe_topic` with a symbol not in the catalog.

**Surface.**
```json
{"isError":true,"content":[{"type":"text","text":"unknown symbol BTC-USDT; available symbols: BTC-USD, ETH-USD, SOL-USD"}]}
```

`describe_topic` raises a parallel `unknown topic <uri>; available topics: …` error when the URI is well-formed but not in the catalog (DEC-030).

**Your response.** Pick a symbol from the listed valid ones, or call `list_topics` to discover what's in the catalog.

---

## WS subscribe: unknown topic

**Trigger.** Your WS client called `subscribe` with a URI that parses correctly but isn't in any venue adapter's catalog (DEC-030). The catalog is authoritative — well-formed-but-unknown URIs are not silently accepted.

**Surface.**
```json
{
  "event": "error",
  "code": "unknown_topic",
  "message": "unknown topic market://coinbase/book/UNKNOWN-USD; available topics: market://coinbase/book/BTC-USD, market://coinbase/book/ETH-USD, …",
  "id": "<your-correlation-id>"
}
```

**Your response.** Pick a URI from the enumerated alternatives, or fetch `/status` and read the `catalog` field for the full list.

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

**Trigger.** `/readyz` returns `503` and `{"ready": false, "components": [{"component":"…","ready":false}, ...]}`.

**Causes.**
- Hub is draining (`draining: true`).
- A subsystem (gateway, MCP, ingestion) hasn't reported ready yet.
- The venue adapter's catalog isn't ready (`ingestion.catalog: false`) — uncommon for v1's hardcoded source which flips ready synchronously, but real for future REST-discovery adapters that gate readiness on first product fetch (DEC-033).

**Your response.** Don't route consumer traffic to this instance. Watch `/readyz` until it flips to `200`. The `components` array names exactly which subsystem is holding readiness.

---

## MCP HTTP session reaped

**Trigger.** An HTTP MCP session has had no activity (no requests, no SSE traffic) for `MCP_SESSION_IDLE_MS` (default 5 min), or the hub is shutting down.

**Surface.** The SSE stream closes. Subsequent requests with the stale `Mcp-Session-Id` get:

```json
{"jsonrpc":"2.0","error":{"code":-32001,"message":"Session not found; re-initialize."},"id":null}
```

(HTTP `404`.)

**Hub response.** The session's bus subscriptions and registry consumer entry are removed, which feeds back into demand-driven upstream lifecycle (DEC-027) — if no consumers remain on a topic, the upstream channel unsubscribes.

**Your response.** Re-`initialize`, capture the new session id, re-`subscribe` to the URIs you care about. Treat session loss the same way you treat a WS reconnect.

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

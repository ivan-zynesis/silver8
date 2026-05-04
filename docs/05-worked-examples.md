# Worked Examples

Each scenario shows the agent's intent, the tool/resource calls to make, and the expected response.

---

## Scenario 1 — "What's the current mid price for BTC-USD?"

**Approach.** Use `get_top_of_book`; `mid` is computed for you.

**Call.**
```json
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_top_of_book","arguments":{"symbol":"BTC-USD"}}}
```

**Response (abridged).**
```json
{"result":{"structuredContent":{
  "venue":"coinbase","symbol":"BTC-USD",
  "bidPrice":67542.10, "askPrice":67543.20,
  "mid":67542.65, "spread":1.10,
  "stale":false, "sequence":4982371, "timestamp":"..."
}}}
```

The `mid` field gives you the answer directly: **67542.65**. If `stale: true`, the value is the last known good — usable for a "best estimate" but not authoritative.

---

## Scenario 2 — "What does the order book look like 5 levels deep on each side for ETH-USD?"

**Approach.** `get_book_snapshot` with `depth: 5`.

**Call.**
```json
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_book_snapshot","arguments":{"symbol":"ETH-USD","depth":5}}}
```

**Response.** A `BookView` with `bids[0..4]` (descending) and `asks[0..4]` (ascending).

---

## Scenario 3 — "Stream BTC-USD updates so I can react in real time."

**Approach.** Subscribe to the resource; on each `notifications/resources/updated`, read the resource for the current state.

**Steps.**
1. `resources/subscribe` to `market://coinbase/book/BTC-USD`.
2. Listen for `notifications/resources/updated` notifications with `params.uri` matching your URI.
3. On each notification, call `resources/read` to get the current `BookView`.

If you instead need only top-of-book changes, poll `get_top_of_book` on a cadence — but subscribe is more efficient and protocol-native.

---

## Scenario 4 — "I see BTC-USD reports stale=true. What now?"

**Approach.** A sequence gap or upstream silence triggered stale-marking. The hub auto-resyncs; your job is to wait and confirm.

1. Call `get_hub_status` to confirm — look at `topics[].stale` and `upstream.coinbase.status`.
2. If `upstream.coinbase.status === "connected"` and the topic is stale, the resync is in flight (typically <1s for small books).
3. Wait briefly and re-call `get_top_of_book`. The `stale` flag clears when a fresh snapshot lands.
4. While stale, you may treat the values as "last known good" or refuse to act on them — your call. See [`06-failure-modes.md`](06-failure-modes.md).

---

## Scenario 5 — "I want to subscribe to a symbol that isn't in the configured list."

**Approach.** You can't (in v1). The hub pre-subscribes upstream only to its configured symbols.

If you call `get_top_of_book` with an unsupported symbol:
```json
{"result":{"isError":true,"content":[{"type":"text","text":"... unknown symbol; available: BTC-USD, ETH-USD, SOL-USD"}]}}
```

The error message lists the valid symbols. The catalog is hardcoded in `packages/ingestion/src/coinbase/coinbase-catalog.ts` per [DEC-031](../opensprint/ADRs/DEC-031.md); to add a symbol, edit that constant and rebuild.

---

## Scenario 6 — "Diagnose: the hub seems frozen."

**Approach.** Walk down the stack.

1. **Liveness?** `GET /healthz` — is the process alive?
2. **Readiness?** `GET /readyz` — has the hub received its first snapshot?
3. **Upstream?** `get_hub_status` → `upstream.coinbase.status`. Look for `disconnected` or many `reconnectAttempts`.
4. **Topic-level?** `get_hub_status` → `topics[]`. Per-topic `stale` and `lastTimestamp`. If `lastTimestamp` is far in the past for an active market, the heartbeat watchdog will reconnect within ~30s.
5. **Logs.** `LOG_LEVEL=debug` shows every connect/reconnect/snapshot/gap. `pnpm start:monolith 2>&1 | jq` to pretty-print.

---

## Scenario 7 — "I received a `rebalance` notification. What does it mean?"

The hub is shutting down (autoscale-down or rolling deploy). It wants you to **finish your current operation, then reconnect to a different instance**. The deadline is in the notification's `deadlineMs`.

For an MCP agent: complete the in-flight tool call, close the connection, and reconnect to the same hub URL — the load balancer will route you to a non-draining pod.

For a WS client: the gateway sends `{event: "rebalance", reason, deadlineMs}`. Same playbook — finish, close, reconnect.

If you do nothing within `deadlineMs`, the hub force-closes the connection at the deadline.

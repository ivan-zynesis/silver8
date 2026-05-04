# MCP Tool Reference

Every tool is a JSON-RPC `tools/call` against a name with strongly-typed Zod-derived JSON Schema arguments. Errors are LLM-actionable strings — see the error rows.

---

## `list_topics()`

**When to use.** First thing to call on a fresh session. Discovers what topics exist. The catalog is authoritative — `list_topics` always returns a meaningful list, even on a cold hub with zero active subscriptions (DEC-030).

**Args.** None.

**Returns.** Array of `{uri, kind, venue, symbol, description}` — sourced from each venue adapter's catalog.

**Example.**
```json
[
  {
    "uri": "market://coinbase/book/BTC-USD",
    "kind": "book",
    "venue": "coinbase",
    "symbol": "BTC-USD",
    "description": "Top-of-book and depth-N L2 order book for BTC-USD on Coinbase. Updates on every level change."
  }
]
```

---

## `describe_topic({uri})`

**When to use.** Once you have a URI from `list_topics`, call this to learn the data shape, cadence, an example payload, and current freshness.

**Args.**
- `uri` *(string, required)* — `market://<venue>/book/<symbol>` URI.

**Returns.**
```jsonc
{
  "uri": "market://coinbase/book/BTC-USD",
  "kind": "book",
  "venue": "coinbase",
  "symbol": "BTC-USD",
  "schema": "BookView { venue, symbol, bids: [...], asks: [...], sequence, timestamp, stale, staleReason? }",
  "cadence": "Updates emitted on every level change; for active markets this is multiple times per second.",
  "examplePayload": { /* ... */ },
  "freshness": { "stale": false, "sequence": 12345, "lastTimestamp": "2026-05-02T12:34:56.789Z" }
}
```

**Errors.**
- `unknown topic <uri>; available topics: market://coinbase/book/BTC-USD, …` — the URI isn't in the catalog. Pick one from the enumerated list, or call `list_topics()`.

---

## `get_top_of_book({symbol, venue?})`

**When to use.** The most common quote-style query. Returns best bid, best ask, mid, and spread for a trading pair.

**Args.**
- `symbol` *(enum, required)* — one of the configured symbols (e.g. `BTC-USD`).
- `venue` *(enum, default `coinbase`)* — only `coinbase` in v1.

**Returns.** `TopOfBook`:
```jsonc
{
  "venue": "coinbase",
  "symbol": "BTC-USD",
  "bidPrice": 50000.00, "bidSize": 1.5,
  "askPrice": 50001.00, "askSize": 0.5,
  "mid": 50000.5,
  "spread": 1.0,
  "sequence": 12345,
  "timestamp": "2026-05-02T12:34:56.789Z",
  "stale": false
}
```

If `stale: true`: the upstream feed has gapped and a resync is in progress; values are the last known good snapshot. See [`06-failure-modes.md`](06-failure-modes.md).

**Errors.**
- `unknown symbol; available: BTC-USD, ETH-USD, SOL-USD` — bad symbol arg.
- `no book state yet for SYMBOL; the upstream feed has not delivered a snapshot. Try get_hub_status to inspect upstream connection state.` — wait or check status.

---

## `get_book_snapshot({symbol, venue?, depth?})`

**When to use.** When you need order-book depth beyond the best bid/ask. Returns top-N levels per side.

**Args.**
- `symbol` *(enum, required)*.
- `venue` *(enum, default `coinbase`)*.
- `depth` *(int 1..50, default 10)* — number of levels per side.

**Returns.** `BookView`:
```jsonc
{
  "venue": "coinbase",
  "symbol": "BTC-USD",
  "bids": [{"price":50000,"size":1.5}, {"price":49999.5,"size":0.7}, ...],
  "asks": [{"price":50001,"size":0.5}, {"price":50001.5,"size":2.1}, ...],
  "sequence": 12345,
  "timestamp": "2026-05-02T12:34:56.789Z",
  "stale": false
}
```

**Errors.** Same as `get_top_of_book`, plus:
- depth out of range (1..50) → JSON-RPC validation error.

---

## `get_hub_status()`

**When to use.** Diagnose hub health. Same payload as the HTTP `/status` endpoint.

**Args.** None.

**Returns.**
```jsonc
{
  "service": "silver8-market-data-hub",
  "mode": "monolith",
  "uptimeSeconds": 1234,
  "catalog": [
    {"uri":"market://coinbase/book/BTC-USD","kind":"book","venue":"coinbase","symbol":"BTC-USD","description":"…"}
  ],
  "active": [
    {"uri":"market://coinbase/book/BTC-USD","consumerCount":3,"stale":false,"sequence":12345,"lastTimestamp":"…"}
  ],
  "consumers": {"ws": 3, "mcp": 1, "totalSubscriptions": 4},
  "upstream": {
    "coinbase": {
      "status": "connected", "connectedAt": "…",
      "symbols": ["BTC-USD","ETH-USD","SOL-USD","AVAX-USD","DOGE-USD","XRP-USD","LINK-USD","MATIC-USD"],
      "lastMessageAt": "…", "reconnectAttempts": 0, "booksKnown": 3
    }
  }
}
```

`catalog` (DEC-030 / DEC-032) is the authoritative answer to "what could a consumer subscribe to?" — populated synchronously at startup. `active` lists currently-warm topics with consumer/freshness info; in demand-driven mode (DEC-027) it starts empty on a cold hub and grows as consumers subscribe.

If `upstream.coinbase.status !== "connected"` *or* an active entry shows `stale: true`, expect tool calls for affected symbols to return stale data or `no book state yet` errors.

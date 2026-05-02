# Topics

The hub exposes topics as URIs of the form `market://<venue>/<kind>/<symbol>`.

## v1 topic surface

| URI shape | Kind | Description |
|---|---|---|
| `market://coinbase/book/<symbol>` | `book` | Live L2 order book for `<symbol>` on Coinbase. Top-50 levels per side. |

`<symbol>` is one of the configured symbols (default: `BTC-USD`, `ETH-USD`, `SOL-USD`). See `COINBASE_SYMBOLS` in [`01-getting-started.md`](01-getting-started.md).

Future kinds — `trades`, `ticker` — slot into the same scheme without architectural change.

## `book` schema

```ts
interface BookView {
  venue: 'coinbase';
  symbol: string;             // e.g. "BTC-USD"
  bids: { price: number; size: number }[];   // sorted descending by price
  asks: { price: number; size: number }[];   // sorted ascending by price
  sequence: number;            // venue-side per-subscription sequence number
  timestamp: string;           // ISO-8601 server-side timestamp of latest applied event
  stale: boolean;              // true while a sequence-gap recovery is in progress
  staleReason?: string;        // populated when stale=true
}
```

## Update cadence

For active markets the L2 channel emits multiple updates per second per symbol. The hub publishes a Bus message on every applied snapshot or update, so MCP `resources/subscribe` and WS gateway consumers see updates at the same cadence as the upstream feed.

## Real example payload

```json
{
  "venue": "coinbase",
  "symbol": "BTC-USD",
  "bids": [
    {"price": 67542.10, "size": 0.832},
    {"price": 67541.95, "size": 1.500},
    {"price": 67540.00, "size": 0.250}
  ],
  "asks": [
    {"price": 67543.20, "size": 0.115},
    {"price": 67543.85, "size": 0.700},
    {"price": 67545.00, "size": 1.100}
  ],
  "sequence": 4982371,
  "timestamp": "2026-05-02T12:34:56.789Z",
  "stale": false
}
```

## Reading top of book

If you only want best bid / best ask:
- **MCP**: call `get_top_of_book({symbol})` — convenience, returns `TopOfBook` directly with `mid` and `spread`.
- **WS**: subscribe to the topic; the first snapshot delivers `data.bids[0]` and `data.asks[0]` as best bid and best ask respectively.

## Sorting guarantees

- `bids` are sorted **descending** by price (best — highest — first).
- `asks` are sorted **ascending** by price (best — lowest — first).
- Within either side, all prices are unique (the hub deduplicates by price level).

## What's NOT in the schema (v1)

- `trades` topic (planned). For now, derive trade activity from book changes.
- Per-level order count (Coinbase L2 doesn't surface it).
- Aggregated mid-price ticker as its own topic (call `get_top_of_book` instead).

# Coinbase L2 Ingestion + Book Maintenance

**Initiative:** market-data-hub
**Milestone:** 2/5

## What

Implement the upstream ingestion subsystem against Coinbase's Advanced Trade WebSocket API. Maintain L2 order book state inside the hub (DEC-009). Detect sequence gaps and recover via resubscribe (DEC-010). Publish normalized Bus messages so gateway and MCP layers can fan out to consumers.

## References

- DEC-007 (venue adapter pattern), DEC-008 (URI scheme), DEC-009 (L2 book in hub)
- DEC-010 (sequence-gap → stale → resync), DS-COINBASE-WS

## Approach

- WS endpoint: `wss://advanced-trade-ws.coinbase.com` (provides `sequence_num` per message).
- Subscribe to `level2` channel for configured symbols on startup.
- Parse `l2_data` events: `snapshot` → `OrderBookStore.applySnapshot` + Bus `book.snapshot`; `update` → `applyUpdate` + Bus `book.update`.
- Track `sequence_num` per connection. On gap (current ≠ prev + 1): mark all subscribed topics stale, emit Bus `book.stale`, unsubscribe + resubscribe to trigger fresh snapshots.
- Reconnect with exponential backoff (1s → 30s) on connection loss; re-subscribe all configured symbols on reconnect.
- Heartbeat watchdog: if no message within `HEARTBEAT_TIMEOUT_MS` (default 30s), treat as connection dead, force reconnect.
- Pre-subscribe to all configured symbols at startup; production deployment can switch to demand-driven via Registry.onDemandChange (architectural surface preserved, not exercised in v1).

## Tests

- Parser: each Coinbase message kind → normalized output.
- BookMaintainer: snapshot + sequence of updates → expected `OrderBookStore` state; out-of-order updates skipped.
- Gap recovery: feed messages with a sequence gap → topics marked stale, resync flow triggered.
- Stale on heartbeat timeout (clock-mocked).

## Non-goals

- Multiple venues (only Coinbase).
- `trades.*` and `ticker.*` topics (book only per DEC-009).
- True demand-driven dynamic upstream subs (the primitive is wired; usage deferred).

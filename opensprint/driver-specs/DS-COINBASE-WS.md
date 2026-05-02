---
id: DS-COINBASE-WS
name: Coinbase WebSocket Protocol
type: technical
status: active
created: 2026-05-02
---

## Summary

Coinbase exposes its public market data via WebSocket. We consume L2 order book data via this feed. The protocol's specifics constrain our ingestion design.

## Key Constraints

- **Per-connection subscription/message limits**: a single WS connection has bounded capacity for concurrent product/channel subscriptions and a message rate ceiling. Exceeding either invites disconnection or rate limiting.
- **L2 channel model**: clients receive an initial snapshot followed by incremental updates. The snapshot establishes the book state; updates apply to it.
- **Sequence numbers**: messages on the L2 channel carry per-product sequence numbers. Gaps indicate dropped messages and require resynchronization (re-subscribe → fresh snapshot).
- **Heartbeats channel**: provides liveness signal independent of update rate. Useful for stale-detection on quiet products.
- **Reconnection expectations**: WS connections can drop unexpectedly; clients are expected to reconnect, re-subscribe, and re-snapshot.
- **Per-IP rate posture**: opening many WS connections from one IP risks rate limiting; horizontal duplication of upstream is operationally wasteful.

## How To Apply

- Ingestion subsystem must own connection lifecycle (connect, heartbeat, reconnect with backoff, resync on gap).
- Sequence-gap detection is mandatory, not optional: gaps trigger stale-signal to consumers and automated resync.
- The hub is the single owner of the upstream relationship. Multiple instances of the hub opening their own upstream WS connections both wastes Coinbase capacity and creates state divergence — this is why ingestion is designed as a singleton tier (sharded by symbol if scaled).
- Heartbeats are subscribed alongside L2 to provide a non-volume liveness signal.

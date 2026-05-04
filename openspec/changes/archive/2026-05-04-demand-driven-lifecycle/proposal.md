# Demand-Driven Upstream Lifecycle (Tiered Grace)

**Initiative:** hub-dashboard-and-lifecycle
**Milestone:** 2/4

## What

Convert the ingestion subsystem from always-on (eager pre-subscription at startup) to **demand-driven** with **tiered grace periods** (DEC-027). The dashboard from M1 will visibly show the lifecycle transitions when consumers come and go.

## References

- DEC-027 (demand-driven upstream lifecycle, tiered grace) — primary
- DEC-007 (venue adapter; M2 fulfills its deferred-action note)
- DEC-005 / DEC-006 (Bus / Registry demand-change primitives)

## Approach

The two tiers (DEC-027):

- **Channel-level (cheap, fast)**: when first consumer subscribes to a topic, the adapter sends a Coinbase `subscribe` op for that product's channel. When the last consumer leaves, send `unsubscribe` immediately. Channel ops are cheap; immediate response gives operators the "watch the change" demo.
- **Socket-level (expensive, slow)**: when zero channels are subscribed, the WS connection enters an *idle* state. After `INGESTION_SOCKET_IDLE_MS` (default 5 minutes), the socket is closed. On the next subscribe, reconnect.

### What changes in code

- `IngestionService` no longer eagerly starts the adapter on bootstrap. It registers a listener on `Registry.onDemandChange` and acts on demand transitions.
- `CoinbaseAdapter` exposes per-channel subscribe/unsubscribe (already present). Adds:
  - `ensureConnected()` — opens the socket if needed; idempotent. First demand calls it.
  - Per-symbol channel state tracking so we know when zero channels are subscribed.
  - Socket-idle timer that fires after `socketIdleMs` of zero-channel state and closes the socket.
- New env vars:
  - `INGESTION_LIFECYCLE` — `demand_driven` (default) or `eager` (legacy compat / demo warm-up). `eager` means subscribe configured symbols at boot, regardless of demand. Default is `demand_driven` per DEC-027.
  - `INGESTION_SOCKET_IDLE_MS` — default `300000` (5 minutes). Configurable so operators can tune it.
- Readiness signal:
  - In `demand_driven` mode, `/readyz` no longer waits for an upstream snapshot before reporting ready. Instead, ingestion declares ready as soon as it is *capable* of subscribing (i.e. after `Registry.onDemandChange` listener is registered).
  - In `eager` mode, behavior matches v1 (wait for first snapshot).

### Status surface

`/status` upstream block gets a `lifecycle: 'demand_driven' | 'eager'` field plus `subscribedChannels: ResourceURI[]` so the dashboard can show *what* is currently subscribed upstream.

The dashboard (M1) already renders the per-topic table; it'll naturally show topics appearing and disappearing as consumers come and go. The `upstream.coinbase.status` pill flips between `connected` ↔ `disconnected` as the socket lifecycle transitions.

## Tests

- `coinbase.adapter` — channel state tracking, idle timer, ensureConnected idempotency.
- `ingestion.service` — onDemandChange-driven subscribe/unsubscribe; eager mode parity.
- Integration-shape (in-memory): registry demand events drive adapter subscribe/unsubscribe in expected order.

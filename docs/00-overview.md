# Silver 8 Market Data Hub — Overview

> A real-time crypto market data hub with a native MCP interface for AI agents and a parallel WebSocket gateway for traditional consumers.

## What this hub is

The hub maintains live L2 (level-2) order book state for a set of trading pairs from Coinbase and exposes that state to two kinds of consumer:

- **AI agents** via the **Model Context Protocol** (MCP). Tools cover discovery and snapshot reads; resources at `market://coinbase/book/<symbol>` support `resources/subscribe` for streaming book updates.
- **Engineers and other software** via a **WebSocket gateway**. A small JSON op protocol lets clients `subscribe` / `unsubscribe` to topics and receive `snapshot` / `update` / `stale` / `fresh` / `lagged` / `rebalance` events.

Both surfaces sit on top of the same internal architecture — an in-memory pub/sub bus, a centralized connection registry, and a single authoritative `OrderBookStore`.

## What it is NOT

- **Not a database**: in-memory state only. On restart, every consumer reconnects and books are rebuilt from a fresh Coinbase snapshot. See [`06-failure-modes.md`](06-failure-modes.md) for what's lost on restart.
- **Not a multi-venue aggregator yet**: scope is single-venue (Coinbase). The architecture supports a future second venue with no structural changes — see [`08-architecture.md`](08-architecture.md).
- **Not multi-topic-kind yet**: only L2 books in v1. `trades.*` and `ticker.*` are deferred but non-disruptive to add.
- **Not autoscaled**: ships *autoscale-ready* (status surface, drain semantics, rebalance hint, /metrics) but the take-home is single-container. Production scale path is documented in [`08-architecture.md`](08-architecture.md).

## Quick mental model

```
┌──────────────────┐
│   Coinbase WS    │     upstream (singleton owner)
└────────┬─────────┘
         │
┌────────▼─────────┐
│   Ingestion      │     parses, applies snapshot+updates,
│   + book state   │     detects sequence gaps, resyncs
└────────┬─────────┘
         │ Bus.publish
   ┌─────┴────────┬───────────────┐
   ▼              ▼               ▼
┌─────────┐  ┌─────────┐    ┌──────────┐
│ Bus     │→ │ Gateway │ →  │ Consumer │   WebSocket
│ (lossy  │  │ (WS)    │    │          │
│ fanout) │  │         │    └──────────┘
│         │  └─────────┘
│         │  ┌─────────┐    ┌──────────┐
│         │→ │ MCP     │ →  │ AI agent │   MCP HTTP+SSE
│         │  │ server  │    │          │   or stdio
└─────────┘  └─────────┘    └──────────┘
```

## Three deployment variants

The same binary supports three composition profiles, selected by `MODE`:

| MODE | Imports | When to use |
|---|---|---|
| `monolith` *(default)* | All components in one process, in-memory seams. | Dev, demo, CI, single-container deployments. |
| `ingestion` | Ingestion only; uses CoreNetworkModule (deferred) for distributed Bus / Store / Registry. | Production split-tier — singleton/sharded ingestion node. |
| `gateway` | WS gateway + MCP only; uses CoreNetworkModule (deferred). | Production split-tier — horizontally autoscaled gateway. |

`CoreNetworkModule` is intentionally not built in v1; the variants prove the architectural seam is real but cannot run operationally without it.

## Where to go from here

- **You're an AI agent**: jump to [`01-getting-started.md`](01-getting-started.md) and [`05-worked-examples.md`](05-worked-examples.md).
- **You're an engineer integrating WS**: jump to [`07-ws-gateway.md`](07-ws-gateway.md).
- **You want the architecture write-up**: see [`08-architecture.md`](08-architecture.md).
- **Something looks broken**: [`06-failure-modes.md`](06-failure-modes.md) names every error/event the hub emits and what to do about it.

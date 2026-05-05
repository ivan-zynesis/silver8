# Architecture

One-page write-up of design choices and trade-offs. For full per-decision rationale see `opensprint/ADRs/`.

## Shape (today)

```
                       MODE=monolith (default)
                                          ┌──────────────────┐
                                          │   Coinbase WS    │
                                          └────────┬─────────┘
                                                   │
┌─────────────────────────────────────────────────────────────────────┐
│  apps/hub  (NestJS, Fastify HTTP adapter)                            │
│                                                                       │
│  ┌──────────────────┐    writes      ┌─────────────────┐             │
│  │ INGESTION        │───────────────▶│ OrderBookStore  │             │
│  │ Coinbase adapter │                │ (in-memory)     │             │
│  │ + book maintainer│                └────────┬────────┘             │
│  └─────────┬────────┘                         │ reads                │
│            │ bus.publish                      │                      │
│            ▼                                  │                      │
│  ┌──────────────────────────────────┐         │                      │
│  │ Bus (in-memory, async, lossy,    │         │                      │
│  │      microtask-queued)           │         │                      │
│  └─────────┬──────────┬─────────────┘         │                      │
│            │          │ bus.subscribe         │                      │
│            ▼          ▼                       │                      │
│  ┌──────────────┐  ┌──────────────┐           │                      │
│  │ Gateway WS   │  │ MCP Server   │◀──────────┘                      │
│  │ + per-cons.  │  │  resources/  │                                  │
│  │   ring queue │  │   subscribe  │                                  │
│  └──────┬───────┘  └──────┬───────┘                                  │
│         │                 │                                           │
│         └───────┬─────────┘                                           │
│                 ▼                                                     │
│  ┌─────────────────────────────────┐                                  │
│  │ Registry  refcount,             │                                  │
│  │           demand-change events  │                                  │
│  └─────────────────────────────────┘                                  │
│                                                                       │
│  HTTP shell: /healthz /readyz /metrics /status /mcp /dashboard/       │
└──────────────────────────────────────────────────────────────────────┘
```

## Three architectural seams (DEC-004)

The hub is built around three named interfaces in `@silver8/core`:

- **`Bus`** — publish/subscribe by topic URI. Async publish, microtask-queued delivery, lossy semantics, demand observable. Same contract as a future NATS or Redis pub/sub adapter.
- **`OrderBookStore`** — single source of truth for L2 book state. Snapshot apply, incremental update, top-N read, stale flag.
- **`Registry`** — consumer lifecycle and refcounted topic subscriptions. Holds live socket references (intrinsically process-local — DEC-006).

In v1 the implementations are in-memory (`@silver8/core-memory`). The intentional split-tier path replaces them with a `CoreNetworkModule` (Redis / NATS-backed) without touching ingestion / gateway / MCP code — the literal demonstration of the adapter pattern.

## Three deployment variants (DEC-016)

The same binary supports three composition profiles, selected at startup by `MODE`:

- `monolith` *(default)* — fully wired in-process. What we ship.
- `ingestion` — composition entry point ready; requires `CoreNetworkModule` (deferred).
- `gateway` — composition entry point ready; requires `CoreNetworkModule` (deferred).

`MODE=ingestion` and `MODE=gateway` exit fast with a clean `CompositionError` that names the missing module. This is itself the architectural proof that the seams are real: a gateway-mode binary literally cannot import the ingestion module's internals.

## Scale path (DEC-017, DEC-018)

| What grows | How it scales |
|---|---|
| Consumer count (more WS / MCP clients) | **Edge tier autoscales horizontally.** Each gateway pod subscribes to the bus for its consumers' topics; the bus copies the same message to N pods. Sticky-session L4 LB; metric is active connection count per pod. |
| Symbol count (more Coinbase subscriptions) | **Ingestion tier shards by symbol.** Singleton today; consistent-hash by symbol when one node can't hold all books. |
| Volume per symbol | **Vertical scale of ingestion.** One core per symbol's book is plenty for our scale. |

**Refcount is correctness/efficiency, not scaling.** The Registry's demand-change events tell the ingestion tier when a topic has zero consumers, so upstream subscriptions can be dropped. This avoids wasted Coinbase capacity; it doesn't help us handle 10× the consumer load.

## What's autoscale-ready (DEC-020) but not deployed

- `/healthz` (liveness) and `/readyz` (readiness, gates on first-snapshot).
- `/metrics` Prometheus exposition: active connections, subscriptions, upstream rate, drops, lagged disconnects, sequence gaps.
- SIGTERM drain via protocol-level rebalance hint to all consumers (DEC-019).
- All necessary primitives for an HPA / Cloud Run autoscaler to operate.

## Production deployment shape (DEC-024)

- **Ingestion tier**: long-running container (Cloud Run min=1, Fly.io machine, or ECS Fargate single task). Not function-as-a-service — a 15-minute Lambda execution cap breaks long-lived upstream WS.
- **Gateway tier**: autoscaled containers (Cloud Run, Fargate). Target metric: 1000 active connections per pod.
- **Bus / Registry / OrderBookStore (network)**: Redis pub/sub for Bus, Redis for Registry/Store; or NATS JetStream for both. Single managed instance; cluster if needed.
- **Cloudflare Durable Objects** is the alternative architecture worth naming: one DO per symbol owns upstream + book state, stateless Workers fan out to consumers. Not chosen because we run on Node.

## Trade-offs we made

| Choice | Why | Cost |
|---|---|---|
| In-memory in v1 | Brief: no DB. Restart loses everything. | Documented; clients reconnect; books rebuild. |
| L2-only topic kind | Architecture for trades/ticker is identical; v1 scope. | Trades and ticker not yet exposed. |
| Stateful MCP HTTP sessions (DEC-035) | `resources/subscribe` is the protocol-native streaming primitive; honoring it requires per-session `McpServer` + transport. | Hub holds session state in-memory; sessions reap on close or after `MCP_SESSION_IDLE_MS` (default 5 min). |
| Demand-driven upstream lifecycle (DEC-027) | Production-shape: only subscribe upstream when a consumer wants the topic; close idle sockets after a grace window. | Cold hub has populated catalog but empty active list; first subscribe pays a snapshot round-trip (~1s). |
| Don't reimplement Kafka | Strategic. If we need partitioned/durable, adopt Kafka. | Bus is "dumb pipe"; durable replay is not provided. |

## What we did NOT build

- `CoreNetworkModule` (Redis / NATS adapters) — the variants compile and fail-fast, but cannot run operationally without this. It is the canonical first follow-up.
- IaC. Production deployment is documented in prose; no Terraform / Pulumi shipped (DEC-024).
- A second venue. The `VenueAdapter` pattern is in place; adding Binance is one new package + one wire format.

## Why NestJS (DEC-002)

Considered: plain TS hand-wired, `tsyringe`, Effect with Layer system. Picked NestJS for: hierarchical module composition, lifecycle hook ordering, DI graph at day 1 — the operator's explicit production-correctness requirements at the start of the project. Effect was the runner-up: more principled Layer-based composition, but uneven reviewer familiarity made it the wrong choice for a 2-week deliverable. Worth revisiting later.

---
id: market-data-hub
status: completed
created: 2026-05-02
completed: 2026-05-04
deadline: 2026-05-04 (2-week sprint from issue date 2026-04-20)
---

## Description

Build the Silver 8 take-home: a real-time crypto market data hub that ingests Coinbase L2 order book data and distributes it to multiple consumers via a subscribable pub/sub interface, with a native MCP server as a first-class AI-agent-facing surface.

The architecture is shaped around three deployment variants from day 1: a `MODE=monolith` default (single-container, in-memory `core-memory` adapters — what we ship), and `MODE=ingestion` / `MODE=gateway` composition entry points that compile against the same seam interfaces, ready for a future distributed `core-network` adapter to enable horizontal scale of the gateway tier and singleton/sharded ingestion. Documentation is treated as a first-class deliverable, structured so a fresh LLM agent can drive the system correctly using only `/docs` and the MCP tool list.

## Driver Specs

- DS-BRIEF
- DS-COINBASE-WS
- DS-MCP
- DS-LLM-USABILITY

## ADRs

- DEC-001 — TypeScript on Node
- DEC-002 — NestJS + Fastify Composition Framework
- DEC-003 — pnpm + Turborepo Monorepo Layout
- DEC-004 — Three Architectural Seams (Bus, OrderBookStore, Registry)
- DEC-005 — In-Memory Bus Honors Distributed Semantics
- DEC-006 — In-Memory Registry as Only Socket-Holding Primitive
- DEC-007 — Venue Adapter Pattern with Normalized Format
- DEC-008 — Topic URI Scheme `market://<venue>/book/<symbol>`
- DEC-009 — L2 Order Book State Maintained in Hub
- DEC-010 — Sequence-Gap Detection, Stale Signaling, Automated Resync
- DEC-011 — Backpressure: Bounded Queue, Drop-Oldest, Sustained-Overflow Disconnect
- DEC-012 — Gateway WebSocket Subscribe-Op Protocol
- DEC-013 — MCP Streaming via `resources/subscribe`
- DEC-014 — MCP Dual Transport (HTTP+SSE primary, stdio supported)
- DEC-015 — MCP Tool Surface (Zod-typed, LLM-legible)
- DEC-016 — Three Deployment Variants via `MODE` Env
- DEC-017 — Scale Path (edge horizontal, ingestion vertical-then-sharded)
- DEC-018 — Autoscale Signal: Active Connection Count Per Pod
- DEC-019 — Graceful Drain via Protocol-Level Rebalance Hint
- DEC-020 — Ship Autoscale-Ready Primitives, Not Autoscale Itself
- DEC-021 — Don't Reimplement Partitioned Messaging
- DEC-022 — Status Surface (HTTP `/status` + parity MCP tool)
- DEC-023 — Documentation as First-Class Deliverable
- DEC-024 — IaC Out of Scope; Production Deployment Shape Documented

## Milestones

- [x] **core-seams-nestjs-skeleton**: Define `core/` interfaces (Bus, OrderBookStore, Registry, types). Ship `core-memory/` implementations honoring distributed semantics (DEC-005). Set up NestJS modules and the three-variant composition root (DEC-016: monolith, ingestion, gateway). Wire observability foundation: structured logger, `/healthz`, `/readyz`, `/metrics` (Prometheus), SIGTERM drain hook scaffold (DEC-020). Bus semantics test suite + Registry churn/storm/slow-consumer tests (DEC-006). _Completed 2026-05-02; 37 tests passing; all three MODE variants verified live._

- [x] **ingestion-coinbase-l2**: Implement `CoinbaseAdapter` (DEC-007) with WS lifecycle, reconnect-with-backoff, heartbeat subscription. Sequence-gap detection + stale signaling + automated per-symbol resync (DEC-010). L2 order book maintenance: snapshot apply + update apply → top-N read views (DEC-009). Demand-driven upstream subscription via `Registry.onDemandChange`. Fixture-replay tests covering gap recovery, reconnect, stale propagation. _Completed 2026-05-02; 14 new tests; live smoke verified upstream-status enrichment + readiness gating._

- [x] **gateway-ws**: WebSocket server with subscribe/unsubscribe op protocol (DEC-012). Per-consumer ring buffer with drop-oldest backpressure + sustained-overflow disconnect (DEC-011); serialize-once-fan-out-many. Rebalance hint message on SIGTERM (DEC-019). Tests: churn (10k connect/disconnect), slow consumer (queue bounded + disconnected, others unaffected), subscribe/unsubscribe storm (no orphan registry entries). _Completed 2026-05-02; 25 new tests; end-to-end WS pair test covers full subscribe/fan-out/drain lifecycle._

- [x] **mcp-server**: NestJS module wrapping `@modelcontextprotocol/sdk`. Tool surface (DEC-015): `list_topics`, `describe_topic`, `get_top_of_book`, `get_book_snapshot`, `get_hub_status`. Zod schemas for all args. Resources at `market://<venue>/book/<symbol>` with `resources/subscribe` and `notifications/resources/updated` (DEC-013). Dual transport: Streamable HTTP primary (modern replacement for legacy SSE), stdio behind `MCP_TRANSPORT=stdio` flag (DEC-014). MCP `notifications/silver8/rebalance` parity with WS rebalance event. `get_hub_status` returns same payload as HTTP `/status` (DEC-022). _Completed 2026-05-02; 13 new tests; live MCP HTTP smoke verified initialize / tools/list / tools/call with both happy and actionable-error paths._

- [x] **docs-ship-package**: `/docs` written for LLM consumption per DEC-023 structure (9 markdown files: overview, getting-started, MCP tool reference, MCP resources, topics, worked examples, failure modes, WS gateway, architecture write-up). Multi-stage Dockerfile with distroless final image. `docker-compose.yml` for local dev with `stop_grace_period` > drain deadline. README with quick-start + architecture-at-a-glance + layout. One-page architecture write-up at `docs/08-architecture.md` covering scale path, deployment variants, production target, what's-lost-on-restart, and design trade-offs. Walkthrough recording is the operator's responsibility (manual deliverable). _Completed 2026-05-02._

## Notes

- IaC explicitly out of scope (DEC-024). Production deployment shape documented in the architecture write-up; no Terraform/Pulumi shipped.
- `CoreNetworkModule` (Redis/NATS-backed adapters for Bus/OrderBookStore/Registry) is **deferred**. The variant entry points (`MODE=ingestion`, `MODE=gateway`) ship in v1 but fail at startup with a clean configuration error if `CoreNetworkModule` isn't present. This is intentional — the variants prove the seam is real.
- Effect (with Layer system) was the considered-and-rejected alternative for the composition framework (DEC-002). Worth revisiting if the team becomes Effect-fluent.

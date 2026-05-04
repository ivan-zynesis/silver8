# Architecture

## System Overview

Silver 8 is a real-time crypto market data hub. It maintains a single connection to Coinbase's L2 order-book WebSocket feed, assembles per-symbol order books from the snapshot+update stream, and fans those books out to multiple downstream consumers through a subscribable pub/sub interface. Two consumer surfaces are first-class: a generic WebSocket gateway (engineers, internal services), and a native MCP server (LLM agents) that uses the Model Context Protocol's resource subscription mechanism so AI consumers can drive the system as a peer of any human-built client.

Three audiences shape the system in parallel: **engineers** read the code and extend the hub; **LLM agents** drive it through MCP tools and `/docs`; **human operators** observe and debug it through a live dashboard, `/status`, and structured logs. All three are treated as load-bearing — the question "could a fresh agent succeed first try?" sits next to "could a fresh operator diagnose a fault?" alongside any conventional engineer-facing concern.

The hub ships as a single Docker image with a `MODE` env that selects one of three composition variants — `monolith` (the shipped default; in-memory adapters; one process), `ingestion` (singleton tier owning the upstream WS), and `gateway` (horizontally scalable consumer-facing tier). The two split-tier variants compile against the same seam interfaces the monolith does and fail loudly at startup until the deferred `CoreNetworkModule` (Redis/NATS-backed adapter implementations) is provided. The variants exist in v1 as proof that the seams are real, not aspirational; the network module is named, scoped, and deferred.

Documentation in `/docs` is treated as a deliverable on par with code: a fresh LLM agent handed only the docs and the MCP tool list must be able to drive the hub correctly on first attempt, and that property is what the architecture optimizes for end-to-end.

## Driver Specs

Five active driver specs anchor every architectural decision.

**Product**

- [DS-BRIEF](driver-specs/DS-BRIEF.md) — Silver 8 take-home brief. Single venue (Coinbase), single-deployable, in-memory state acceptable, MCP server as a first-class surface, `/docs` written for LLM consumption, one-page architecture write-up, 10-minute walkthrough. Multi-venue extensibility is an explicit architectural requirement even though only Coinbase ships in v1. Evaluation criteria weight architecture clarity, correctness under stress, LLM usability, and ergonomics for an engineer extending the system. This is the foundational driver — every ADR traces back to a constraint or evaluation criterion here.

**Technical**

- [DS-COINBASE-WS](driver-specs/DS-COINBASE-WS.md) — Coinbase WebSocket protocol constraints. Per-connection subscription/message limits, snapshot-then-incremental L2 channel, per-product sequence numbers (gaps require resync), heartbeats channel for liveness, expected reconnect-and-resnapshot semantics on drops, per-IP rate posture that punishes opening many WS connections from one source. The combination forces the hub to be the singular owner of the upstream relationship — multiple replicas opening their own sockets both wastes Coinbase capacity and creates state divergence.
- [DS-MCP](driver-specs/DS-MCP.md) — Model Context Protocol surface. Tools (typed request/response operations), resources (URI-addressable content with `resources/subscribe` for streaming), and dual transports (stdio for local agent installs, HTTP+SSE for shared deployments). The official `@modelcontextprotocol/sdk` is transport-agnostic at the server-logic level. Tool names, descriptions, and argument schemas are LLM-facing; their quality is load-bearing.

**Quality**

- [DS-LLM-USABILITY](driver-specs/DS-LLM-USABILITY.md) — LLM as first-class consumer. A fresh agent with only `/docs` and the MCP tool list must succeed on first attempt. Drives action-verb tool naming, Zod-typed enums, descriptions that explain *when* to use each tool, agent-actionable error messages (`unknown symbol BTC-USDT; available: BTC-USD, ETH-USD, SOL-USD`), human-and-LLM-legible URI schemes, and `/docs` structured around purpose-statement / topic-schemas / worked-examples / failure-modes.
- [DS-OPERATOR-USABILITY](driver-specs/DS-OPERATOR-USABILITY.md) — Operator as first-class consumer, parallel to LLM-USABILITY. A live dashboard makes `/status` data human-legible; lifecycle transitions (consumer attach/detach, upstream connect/disconnect, drain) are observable in real time; integration tests run against a deterministic harness an operator can reproduce locally with one command; the same `docker-compose.yml` that runs the tests is the shape of the deployment artifact. Quality test: "can a fresh operator diagnose a fault?"

DS-LLM-USABILITY and DS-OPERATOR-USABILITY are reinforcing — actionable error messages, consistent URI schemes, and observable state transitions serve both audiences — but they target different surfaces (MCP tools + `/docs` for the agent; dashboard + `/status` + structured logs for the human).

## Architectural Decisions

The decision tree fans out from the driver specs in five depth layers. The narrative below walks them in roughly that order, grouping decisions by the structural commitment they make.

### Foundation: language, framework, monorepo

We chose **TypeScript on Node** ([DEC-001](ADRs/DEC-001.md)) because the MCP SDK is most mature on Node and pairs natively with Zod for schema-to-tool wiring; Bun was the close second but lost on stability given a Docker-image deliverable. Composition is **NestJS with the Fastify adapter** ([DEC-002](ADRs/DEC-002.md)) — modules-of-modules, topologically-ordered lifecycle hooks (`OnModuleInit` / `OnApplicationShutdown`), scoped DI, sub-tree testing via `Test.createTestingModule().overrideProvider()`. Nest owns DI and lifecycle only; the WebSocket server (`ws`) and MCP SDK live as plain providers, isolating Nest to where it adds value. Effect with its Layer system was the considered-and-rejected alternative — worth revisiting when the team is Effect-fluent. The repo is **pnpm workspaces + Turborepo** ([DEC-003](ADRs/DEC-003.md)), with the package graph mirroring the architectural seams so reading the layout teaches the architecture.

### The three seams

The structural commitment that makes everything else possible is the **three architectural seams** ([DEC-004](ADRs/DEC-004.md)) defined as interfaces in `core/`: `Bus` (lossy fanout), `OrderBookStore` (current-state book maintenance), and `Registry` (consumer connection accounting). All component code depends only on the interfaces; `core-memory` ships in-memory implementations. Three seams instead of one is a deliberate honesty about scaling — a NATS Bus, a Redis OrderBookStore, and a Redis Registry have very different shapes, and pretending they're one "DataPlane" would smear the distinctions.

The in-memory `Bus` ([DEC-005](ADRs/DEC-005.md)) is **not** a synchronous EventEmitter wrapper. It honors the same semantics a distributed bus would: async publish (microtask-queued), no in-stack error propagation, lossy under bounded queues, FIFO only within a topic, and `onDemandChange(topic, count)` for the ingestion tier to drive upstream subscriptions from refcounted demand. This commitment makes "drop-in replacement" with a future NATS or Redis adapter a real claim, not theatrical — the in-memory implementation is the reference implementation of the contract, exercised by the same Bus semantics test suite a future `core-nats` would have to pass.

The `Registry` ([DEC-006](ADRs/DEC-006.md)) is in-memory, and that is **not a tradeoff** — it is a structural fact. Socket references are not serializable; the send capability is process-local. External stores (Redis, Postgres) hold metadata about connections, not the sockets themselves. The architectural commitment is therefore to *manage the in-memory hazards by design*: bounded per-consumer ring buffers prevent unbounded send queues; one cleanup path through `Registry.removeConsumer(id)` prevents orphan map entries; serialize-once-fan-out-many prevents hot-symbol amplification; and what's lost on restart (sockets, queues, book state) is documented explicitly. Three test invariants enforce these: a 10k-cycle churn test (RSS stable), a slow-consumer test (queue bounded, others unaffected), and a subscribe/unsubscribe storm test (no orphans).

### Ingestion, books, and gap recovery

The ingestion tier follows a **venue adapter pattern with a normalized internal format** ([DEC-007](ADRs/DEC-007.md)). Each venue implements `VenueAdapter`; messages are translated to `NormalizedMessage` (venue, symbol, channel, sequence, payload, server timestamp) before they hit the Bus or OrderBookStore. Components downstream of the adapter are venue-agnostic; adding Binance is one new package. Topic URIs are **`market://<venue>/book/<symbol>`** ([DEC-008](ADRs/DEC-008.md)) — used uniformly as Bus topic key, MCP resource URI, and WS gateway subscribe target. The scheme is human-and-LLM legible (`market://coinbase/book/BTC-USD`) and admits safe expansion: `market://coinbase/trades/BTC-USD`, `market://binance/book/BTC-USDT`.

**L2 book state lives inside the hub** ([DEC-009](ADRs/DEC-009.md)). Snapshots and updates flow into `OrderBookStore`; what the hub exposes is a top-N levels snapshot, not raw deltas. Diff application stays inside the hub — LLM consumers never need to apply diffs. The single topic kind in v1 is `book`; `trades` and `ticker` are cheap future additions that require no architecture change.

**Sequence-gap detection is mandatory** ([DEC-010](ADRs/DEC-010.md)). On gap: mark the topic stale, emit explicit stale notifications (WS `{event:"stale", reason:"sequence_gap"}`; MCP `notifications/resources/updated` with stale-tagged content), trigger per-symbol resync (unsubscribe + re-subscribe → fresh snapshot), and clear the stale flag once fresh updates apply against the new snapshot. Heartbeat watchdogs trigger stale even without an explicit gap. Per-symbol resync (rather than full-connection restart) is the targeted fix that doesn't penalize neighbors. The stale flag surfaces all the way to MCP responses — `get_top_of_book(...)` returns `{stale: boolean}` — and is documented in `/docs/06-failure-modes.md` so an LLM agent has a recovery path from the response alone.

**Demand-driven upstream lifecycle** ([DEC-027](ADRs/DEC-027.md)) is the production-target behavior, not a configurable mode. Channel-level: subscribe upstream when the first consumer subscribes to a topic; unsubscribe immediately when the last consumer leaves. Socket-level: keep the WS warm for a 5-minute idle window after zero channels are subscribed; close it after that, reconnect on next demand. The two tiers serve different timescales — channel ops are cheap and frequent, socket ops are expensive and reserved for genuinely idle hubs. This ADR fulfills the deferred note in DEC-007 ("Demand-driven dynamic upstream subscription via Registry.onDemandChange — primitive present, action deferred"); DEC-007 itself remains active for the venue-adapter and normalized-format aspects.

### Consumer surfaces: WebSocket gateway and MCP

The **WebSocket gateway** ([DEC-012](ADRs/DEC-012.md)) speaks a small JSON op protocol: client `{op:"subscribe"|"unsubscribe"|"ping", resource:...}`; server `{event:"snapshot"|"update"|"stale"|"lagged"|"rebalance"|"error", ...}`. Same `market://` URIs as MCP. Trivially testable from a browser console, `wscat`, or any HTTP client with WS support.

**Backpressure** ([DEC-011](ADRs/DEC-011.md)) is per-consumer-per-subscription bounded ring buffer with **drop-oldest** policy (fresh data wins for market data); if the queue stays at-or-near capacity for the sustained-overflow window (5s default), the consumer is disconnected with a `lagged` reason code. `socket.bufferedAmount` is checked against a watermark (1MB default) on every send. Outgoing messages are **serialized once** per upstream tick, and the same buffer is `socket.send()`-ed to each subscribed consumer — preventing hot-symbol amplification. The drop is consumer-visible: `lagged` events let an LLM agent re-fetch the snapshot via `get_book_snapshot`.

The **MCP server** uses **`resources/subscribe`** for streaming ([DEC-013](ADRs/DEC-013.md)) — the protocol-native streaming primitive, signaling AI-native architectural intent. Each topic is an MCP resource at its `market://` URI; agents subscribe; the server emits `notifications/resources/updated`; agents receive current top-N snapshot content. We accept that some MCP clients have weaker subscribe support and hedge with **dual transport** ([DEC-014](ADRs/DEC-014.md)): HTTP+SSE primary (network-addressable, multiple consumers) and stdio behind `MCP_TRANSPORT=stdio` (local Claude Desktop / MCP Inspector). The SDK is transport-agnostic at the server-logic level; dual support is essentially free.

The **MCP tool surface** ([DEC-015](ADRs/DEC-015.md)) is five Zod-typed tools — `list_topics()`, `describe_topic(uri)`, `get_top_of_book(symbol, venue?)`, `get_book_snapshot(symbol, venue?, depth?)`, `get_hub_status()` — plus the streaming resources. Design rules are explicit: action-verb names, Zod enums where the value space is closed, descriptions that explain *when* to use each tool, and actionable errors. Zod schemas flow directly into MCP tool argument schemas, so the published schema and the validation schema are one source of truth.

### Status, dashboard, and operator usability

The **status surface** ([DEC-022](ADRs/DEC-022.md)) is two surfaces with the same payload: HTTP `GET /status` (engineers, dashboards, automated checks) and MCP `get_hub_status()` (LLM agents, no need to leave MCP). Payload includes uptime, upstream connection state per venue (status, since, channels, msg/s, last_message_at), per-topic state (consumer count, msg/s, stale flag, last_update_at), and per-surface consumer counts (WS gateway, MCP server). One source of truth for the data shape; documentation and tests stay honest.

The **dashboard** ([DEC-025](ADRs/DEC-025.md)) is a real Vite + React + TypeScript app at `apps/dashboard`, served statically by the hub at `/dashboard`. Same container, no new tier. MVP scope (status panel + one live book ticker) but production-realistic foundation that grows into the full ops dashboard without rewriting. The **dashboard data plane** ([DEC-026](ADRs/DEC-026.md)) uses the *same surfaces production consumers will use*: HTTP poll on `/status` every 1–2s for slow-moving telemetry, WS gateway subscribe for live book updates. No dashboard-specific endpoints. By building the dashboard on production surfaces, we *prove* — not just assert — that those surfaces are sufficient for human operability.

### Deployment variants and the scale path

The single binary supports **three deployment variants** ([DEC-016](ADRs/DEC-016.md)) selected at startup by `MODE`:

```
MODE=monolith   (default — dev, demo, CI)
   CoreMemoryModule + IngestionModule + GatewayWsModule + McpServerModule
   → in-memory Bus / OrderBookStore / Registry; one process; fully operational

MODE=ingestion  (production ingestion tier — DEFERRED runtime)
   CoreNetworkModule + IngestionModule
   → bus/store/registry adapters point at Redis/NATS; no consumer surfaces

MODE=gateway    (production gateway tier — DEFERRED runtime)
   CoreNetworkModule + GatewayWsModule + McpServerModule
   → bus/store/registry adapters point at Redis/NATS; no upstream Coinbase WS
```

`CoreNetworkModule` is deferred from v1; starting `MODE=ingestion` or `MODE=gateway` without it fails with a clean configuration error. This *operationalizes* the seams — the binary itself enforces that ingestion and gateway communicate only through Bus/OrderBookStore/Registry.

The **scale path** ([DEC-017](ADRs/DEC-017.md)) draws a sharp line: refcount is correctness/efficiency (decides whether to subscribe upstream at all), not scaling. Consumer count grows by adding gateway replicas with sticky-session L4 LB and least-connections distribution. Symbol count grows by sharding ingestion by symbol (operational placement, not partition protocol — closer to consistent-hashing than to Kafka partitions). Volume per symbol grows by vertical scale of ingestion. Horizontal-replicating the entire monolith is explicitly rejected because it multiplies upstream load and creates book-state divergence. Symbol-partitioning the messaging layer is explicitly rejected — that's reimplementing Kafka.

The **autoscale signal** ([DEC-018](ADRs/DEC-018.md)) for the gateway tier is **active consumer connection count per pod** (`hub_active_consumer_connections{pod=...}`), with a target around 1000 connections/pod, consumed via the standard custom-metrics path (Prometheus → prometheus-adapter → HPA, CloudWatch target tracking, Fly.io native). CPU and memory are misleading for fanout WebSocket services.

**Graceful drain** ([DEC-019](ADRs/DEC-019.md)) is a protocol-level rebalance hint: `{event:"rebalance", reason:"scale-down", deadline_ms:30000}` over WS, `notifications/rebalance` over MCP. SIGTERM sequence: flip `/readyz` to not-ready (LB stops sending new connections), broadcast rebalance hint, wait `deadline_ms` or until count hits zero, force-close remaining, exit. Documented in `/docs` failure modes so LLM agents have a clear instruction.

**Ship autoscale-ready primitives, not autoscale itself** ([DEC-020](ADRs/DEC-020.md)) is the scope-cut for v1: `/healthz`, `/readyz`, `/metrics` (Prometheus), SIGTERM drain, rebalance message — but no HPA configs, no Terraform, no deployment policies. Flipping on autoscale at deploy time requires no code changes.

**Don't reimplement partitioned messaging** ([DEC-021](ADRs/DEC-021.md)) is a strategic commitment: a future maintainer who finds themselves implementing partition routing inside this codebase should stop and adopt Kafka. The Bus contract is intentionally lossy and unordered-across-topics; a maintainer who tries to add ordering or durability is changing the contract and should treat it as a deliberate, documented decision.

### Documentation, deployment shape, and integration testing

**Documentation is a first-class deliverable** ([DEC-023](ADRs/DEC-023.md)). `/docs` ships nine structured pages: overview, getting-started, MCP tool reference, MCP resources, topics, worked examples, failure modes, WS gateway, architecture write-up. Worked examples are real (executed against a running hub, output captured); failure modes name the exact event/notification an agent will see and the recommended response. The eval criterion translates directly to "did the docs work?" — so the docs are structured to *be worked*, not just read.

**IaC is out of scope** ([DEC-024](ADRs/DEC-024.md)) — production deployment shape is documented as prose. Documented target: ingestion tier as a long-running container (Cloud Run min=1, Fly machine, or ECS Fargate single task; explicitly not function-as-a-service because Lambda's 15-minute cap breaks long-lived upstream WS); gateway tier autoscaled on connection count; Bus/Registry/Store backed by Redis pub/sub or NATS JetStream; Cloudflare Durable Objects noted as the one genuine serverless answer (one DO per symbol owning upstream + book state) but not the path we'd take with Node.

The **Coinbase mock from real-session captures** ([DEC-028](ADRs/DEC-028.md)) is the test-fidelity commitment: a small WebSocket server (`apps/coinbase-mock`) replays fixtures captured from real Coinbase sessions, including envelopes, sequence numbers, heartbeats, and timing. Fault-injection knobs let tests inject sequence gaps, drop the connection mid-stream, stop emitting heartbeats, or slow-emit messages. The methodology — *"mock from observed, not imagined"* — prevents the failure mode where tests pass against a synthetic mock but the system fails against the real venue.

**Integration test infrastructure** ([DEC-029](ADRs/DEC-029.md)) is `apps/integration-tests`, a vitest-driven test package that orchestrates a `docker-compose.yml` with two services: `coinbase-mock` (DEC-028) and `hub` (built from the existing Dockerfile, configured to point at the mock). Tests boot the stack, connect WS/MCP clients, drive lifecycle via fault-injection, and assert behavior end-to-end across: subscribe → upstream attach → snapshot → gap → stale → resync → fresh snapshot, last-consumer disconnect → channel unsub → idle window → socket close, slow-consumer overflow → lagged → disconnect, SIGTERM → rebalance → drain.

The structural insight: **this same `docker-compose.yml` IS the deployment recipe**. Production replaces `coinbase-mock` with the real venue and replaces `docker compose` with the production orchestrator. Same image, same env vars, same service topology. The take-home defers IaC (DEC-024) but the compose file *is* the IaC; the production extension is an orchestration swap, not a new artifact. DEC-029 extends DEC-024 — production deployment shape is now documented in code, not only in prose.

## System Structure

The hub ships as a single container (default `MODE=monolith`) with the following internal structure:

```
                            ┌─────────────────────────────────────────────────┐
                            │              hub container (Node.js)            │
                            │                                                 │
                            │   ┌────────────────────────────────────────┐    │
                            │   │  IngestionModule                       │    │
                            │   │   ├─ CoinbaseAdapter (ws lifecycle,    │    │
                            │   │   │   heartbeats, seq-gap, resync)     │    │
                            │   │   └─ Book maintenance → OrderBookStore │    │
                            │   └────────────────────────────────────────┘    │
                            │                     │                           │
                            │             [ NormalizedMessage ]               │
   ┌──────────────┐         │                     │                           │
   │  Coinbase    │  WS     │                     ▼                           │
   │  Advanced    │◀────────│   ┌────────────────────────────────────────┐    │
   │  Trade WS    │         │   │  CoreMemoryModule                      │    │
   └──────────────┘         │   │   ├─ Bus (lossy, async, demand-aware)  │    │
                            │   │   ├─ OrderBookStore (top-N snapshots)  │    │
                            │   │   └─ Registry (in-memory, refcounted)  │    │
                            │   └────────────────────────────────────────┘    │
                            │           │                  │                  │
                            │           ▼                  ▼                  │
                            │   ┌──────────────┐    ┌──────────────────┐      │
                            │   │ GatewayWs    │    │  McpServerModule │      │
                            │   │ Module       │    │   ├─ Tools (5)   │      │
                            │   │ (subscribe   │    │   └─ Resources   │      │
                            │   │  op proto)   │    │      (subscribe) │      │
                            │   └──────────────┘    └──────────────────┘      │
                            │           │                  │                  │
                            │   ┌──────────────────────────────────────┐      │
                            │   │  Observability (logger, /healthz,    │      │
                            │   │  /readyz, /metrics, /status, drain)  │      │
                            │   └──────────────────────────────────────┘      │
                            │                                                 │
                            │   ┌──────────────────────────────────────┐      │
                            │   │  /dashboard  (Vite + React static)   │      │
                            │   └──────────────────────────────────────┘      │
                            └─────────────────────────────────────────────────┘
                                  │             │             │           │
                                  ▼             ▼             ▼           ▼
                              WS clients    MCP clients   browsers    monitoring
                              (engineers)   (LLM agents)  (operators) (Prometheus)
```

**Package layout** (`pnpm` workspaces; package boundary mirrors the seam boundary):

```
packages/
├── core/                # interfaces: Bus, OrderBookStore, Registry, types
├── core-memory/         # InMemoryBus, InMemoryOrderBookStore, InMemoryRegistry
├── ingestion/           # CoinbaseAdapter, sequence/gap, book maintenance,
│                        #   demand-driven upstream lifecycle
├── gateway-ws/          # WS server, subscribe op protocol, backpressure
├── mcp-server/          # MCP server: tools + resources/subscribe
└── observability/       # logger, status surface, metrics, /healthz, /readyz

apps/
├── hub/                 # composition root: NestJS modules wired per MODE
├── dashboard/           # Vite + React + TS, served at /dashboard
├── coinbase-mock/       # capture-replay WS server with fault injection
└── integration-tests/   # vitest + docker-compose end-to-end harness
```

**Topic addressing**: every subscribable resource is `market://<venue>/book/<symbol>`. Used uniformly as Bus topic key, MCP resource URI, and WS gateway subscribe target. Examples: `market://coinbase/book/BTC-USD`, `market://coinbase/book/ETH-USD`.

**MCP tool surface**:

| Tool | Purpose |
|---|---|
| `list_topics()` | Available topics with `{ uri, kind, venue, symbol, description }`. |
| `describe_topic(uri)` | Schema, update cadence, example payload, freshness for a topic. |
| `get_top_of_book(symbol, venue?)` | Best bid, best ask, mid, spread, timestamps, `stale: boolean`. |
| `get_book_snapshot(symbol, venue?, depth?)` | Top-N levels of the order book. |
| `get_hub_status()` | Same payload as HTTP `/status`. |

Plus resources at `market://<venue>/book/<symbol>` for streaming via `resources/subscribe`.

**Observability primitives**: `/healthz` (liveness), `/readyz` (true only after upstream connect + book initialized), `/metrics` (Prometheus exposition with `hub_active_consumer_connections`, `hub_active_subscriptions`, `hub_upstream_message_rate`, `hub_upstream_connection_status`), `/status` (JSON; same payload as MCP `get_hub_status()`), structured logs.

**Deployment shape (documented, not shipped)**:

```
   ┌──────────────────┐      Bus        ┌──────────────────────┐
   │ Ingestion Tier   │ ◀──────────────▶│  Edge / Gateway Tier │
   │ MODE=ingestion   │   Redis/NATS    │  MODE=gateway        │
   │ singleton (per   │                 │  autoscaled (HPA on  │
   │  symbol shard)   │                 │   connection count)  │
   └──────────────────┘                 └──────────────────────┘
           │                                     │
           ▼                                     ▼
   ┌──────────────┐                  ┌────────────────────────┐
   │ Coinbase WS  │                  │  WS / MCP / dashboard  │
   │  upstream    │                  │       consumers        │
   └──────────────┘                  └────────────────────────┘
```

The compose file at the repo root *is* the deployment recipe. Production replaces `coinbase-mock` with the real venue and replaces `docker compose` with the production orchestrator (Fly Machines, Cloud Run, Kubernetes); same image, same env vars, same service topology. The deferred `CoreNetworkModule` (Redis pub/sub for Bus, Redis hash/sorted-set for Registry, or NATS JetStream for both) is named, scoped, and is the one piece that needs to land before the split-tier modes go live.

## Constraints & Non-Negotiables

These bound every implementation choice and are the criteria future ADRs must respect.

**From DS-BRIEF:**

- Single-deployable: single-container or single-binary; v1 is one Docker image.
- No database required; in-memory state is acceptable, but what is lost on restart must be explicit (sockets, queues, book state — books rebuild from Coinbase snapshot on reconnect).
- Multi-venue extensibility is an architectural requirement even though only Coinbase ships in v1; "adding a venue is a simple exercise" is the test.
- `/docs` is a deliverable on par with code; eval criterion is "how far a fresh agent gets when handed only the docs and MCP tool list."
- Production-shaped code: tests, structured logs, configuration files, Dockerfile, README.
- Correctness under stress (reconnects, stale states) is an explicit eval criterion.

**From DS-COINBASE-WS:**

- The hub is the singular owner of the upstream Coinbase relationship. Multiple replicas opening their own sockets violates the architecture.
- Sequence-gap detection is mandatory, not optional.
- Heartbeats are subscribed alongside L2 to provide non-volume liveness.
- Reconnect-and-resnapshot is expected behavior, not a failure mode.
- Per-IP rate posture means horizontal duplication of upstream is operationally wasteful.

**From DS-MCP:**

- Tool argument schemas must be expressible as JSON Schema; we author them as Zod, which generates JSON Schema automatically.
- Tool naming, descriptions, and argument schemas are LLM-facing first, engineer-facing second. Quality is load-bearing for usability.
- `resources/subscribe` is the protocol-native streaming primitive — used in preference to tool polling or hub-specific protocols.

**From DS-LLM-USABILITY:**

- A fresh LLM agent with only `/docs` and the MCP tool list must succeed on first attempt.
- Errors must be agent-actionable from the message string alone.
- URI schemes and tool names must read naturally to an LLM.
- When making design tradeoffs, prefer the option that an LLM is more likely to use correctly first try, even at minor cost to engineer ergonomics.

**From DS-OPERATOR-USABILITY:**

- Every state transition that affects behavior (consumer attach/detach, upstream connect/disconnect, drain initiated) is visible somewhere — dashboard, status, structured log, or all three. "Only by reading logs at debug level" means the surface is incomplete.
- Test infrastructure is part of the system; tests are operator-runnable with one command and produce understandable output.
- The recipe that runs the integration tests is the shape of the deployment artifact.

**Architectural commitments that hold across all future work:**

- Components depend only on the three seam interfaces (`Bus`, `OrderBookStore`, `Registry`), never on a concrete implementation. The split-tier `MODE=ingestion` / `MODE=gateway` variants enforce this by construction.
- The in-memory adapters honor the same semantics a distributed implementation must. "Drop-in replacement" is a real claim, exercised by a Bus semantics test suite.
- Don't reimplement partitioned messaging inside the Bus. If durability or partition routing becomes a requirement, adopt Kafka.
- Don't run the hub as function-as-a-service. Long-lived upstream WS is incompatible with Lambda's execution model.
- Refcount is correctness/efficiency, not scaling. Scaling levers are: edge horizontal, ingestion vertical-then-sharded.

# Silver 8 Market Data Hub

Real-time crypto market data hub with a native MCP interface for AI agents and a parallel WebSocket gateway for traditional consumers. Single-venue (Coinbase L2) in v1; architecture supports multi-venue extension without restructuring.

## Quick start

```bash
pnpm install
pnpm build
pnpm start:monolith
```

Then:

```bash
# health
curl http://localhost:3000/healthz

# status
curl http://localhost:3000/status | jq

# MCP — initialize
curl -sS -X POST http://localhost:3000/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"hello","version":"0"}}}'

# MCP — call a tool
curl -sS -X POST http://localhost:3000/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_top_of_book","arguments":{"symbol":"BTC-USD"}}}'

# WS gateway
wscat -c ws://localhost:3001/
> {"op":"subscribe","resource":"market://coinbase/book/BTC-USD"}
```

## Documentation

- **[`docs/00-overview.md`](docs/00-overview.md)** — what this is and isn't
- **[`docs/01-getting-started.md`](docs/01-getting-started.md)** — setup, env vars, both transports
- **[`docs/02-mcp-tool-reference.md`](docs/02-mcp-tool-reference.md)** — all 5 MCP tools
- **[`docs/03-mcp-resources.md`](docs/03-mcp-resources.md)** — `resources/subscribe` flow
- **[`docs/04-topics.md`](docs/04-topics.md)** — topic schemas and example payloads
- **[`docs/05-worked-examples.md`](docs/05-worked-examples.md)** — end-to-end agent scenarios
- **[`docs/06-failure-modes.md`](docs/06-failure-modes.md)** — every error/event the hub emits
- **[`docs/07-ws-gateway.md`](docs/07-ws-gateway.md)** — WebSocket subscribe protocol
- **[`docs/08-architecture.md`](docs/08-architecture.md)** — one-page architecture write-up

The `docs/` directory is structured for **LLM consumption** — a fresh agent given only these docs and the MCP tool list should be able to drive the system correctly on first attempt. That's the eval criterion this take-home is judged on.

## Architecture at a glance

```
┌──────────────────┐
│   Coinbase WS    │
└────────┬─────────┘
         ▼
┌──────────────────┐    ┌─────────────────┐
│ Ingestion        │──▶ │ OrderBookStore  │
│ + book maintain. │    │ (in-memory)     │
└────────┬─────────┘    └────────┬────────┘
         │ Bus.publish           │ reads
         ▼                       │
┌─────────────────────┐          │
│ Bus (in-memory)     │          │
└─────────┬───────────┘          │
          │ subscribe            │
   ┌──────┴──────┐               │
   ▼             ▼               │
┌──────┐    ┌──────────┐ ◀───────┘
│ WS   │    │ MCP      │
│ gw   │    │ server   │
└──────┘    └──────────┘
   ▲             ▲
   │             │
ws clients   AI agents
```

Three architectural seams — `Bus`, `OrderBookStore`, `Registry` — are interfaces in `@silver8/core`. In-memory implementations ship in v1; the same shape can be swapped for a Redis/NATS-backed `CoreNetworkModule` for split-tier deployment. The binary supports three deployment variants (`MODE=monolith|ingestion|gateway`) — the variants prove the seam is real.

## Layout

```
silver8/
├── apps/
│   └── hub/                     composition root, HTTP shell, mode selection
├── packages/
│   ├── core/                    interfaces: Bus, OrderBookStore, Registry, Drainable
│   ├── core-memory/             in-memory impls (DEC-005, DEC-006)
│   ├── ingestion/               Coinbase adapter, sequence/gap detection, book maintainer
│   ├── gateway-ws/              WebSocket subscribe protocol + bounded backpressure
│   ├── mcp-server/              MCP tools + resources/subscribe + dual transport
│   └── observability/           Pino logger, Prometheus metrics
├── docs/                        LLM-targeted documentation
├── opensprint/                  architectural decisions (driver-specs + ADRs)
├── openspec/                    per-milestone change records
├── Dockerfile
└── docker-compose.yml
```

## Tests

```bash
pnpm test         # vitest run, all packages
pnpm typecheck    # tsc -b across the project graph
```

89 tests across 11 files cover Bus semantics, Registry lifecycle and churn fuzz, OrderBookStore correctness, Coinbase parser and gap recovery, WS gateway end-to-end (real WS pair), MCP tool validation and status parity.

## Configuration

See [`docs/01-getting-started.md`](docs/01-getting-started.md) for the full env table. Key knobs:

- `MODE` — `monolith` | `ingestion` | `gateway`
- Coinbase catalog symbols are hardcoded in `packages/ingestion/src/coinbase/coinbase-catalog.ts` per [DEC-031](opensprint/ADRs/DEC-031.md); not env-configurable in v1
- `MCP_TRANSPORT` — `http` (default) | `stdio`

## Restart semantics

In-memory only. On restart: every consumer reconnects, books rebuild from a fresh Coinbase snapshot (~1s for active markets), Registry refcounts reset to zero. No durability promised. See [`docs/06-failure-modes.md`](docs/06-failure-modes.md).

## License

Take-home submission. Not licensed for redistribution.

## AI-assist transparency

Per the brief's ground rules: AI assistants (Claude Opus 4.7) were used throughout. The architectural decisions captured in `opensprint/` were brainstormed interactively; the implementation was written through the same loop. Every decision has an ADR with the alternatives considered and the rationale.

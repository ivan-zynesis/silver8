# Decision Map

## Decision Tree

Layered by depth. Each ADR is shown with its direct dependencies. Driver-specs are roots (DS-*); ADRs are leaves and inner nodes (DEC-*).

```
DRIVER SPECS (roots)
  DS-BRIEF             Silver 8 Take-Home Brief
  DS-COINBASE-WS       Coinbase WebSocket Protocol
  DS-MCP               Model Context Protocol
  DS-LLM-USABILITY     LLM as First-Class Consumer

DEPTH 0  (depend only on driver-specs)
  DEC-001  TypeScript on Node                          ← DS-BRIEF, DS-MCP
  DEC-004  Three Architectural Seams (Bus/Store/Reg)   ← DS-BRIEF
  DEC-007  Venue Adapter Pattern                       ← DS-COINBASE-WS, DS-BRIEF
  DEC-009  L2 Order Book State in Hub                  ← DS-COINBASE-WS, DS-LLM-USABILITY
  DEC-013  MCP Streaming via resources/subscribe       ← DS-MCP, DS-LLM-USABILITY
  DEC-014  MCP Dual Transport (HTTP+SSE / stdio)       ← DS-MCP
  DEC-015  MCP Tool Surface                            ← DS-MCP, DS-LLM-USABILITY
  DEC-023  Documentation as First-Class Deliverable    ← DS-LLM-USABILITY, DS-BRIEF

DEPTH 1
  DEC-002  NestJS + Fastify Adapter                    ← DEC-001
  DEC-003  pnpm + Turborepo Monorepo                   ← DEC-001
  DEC-005  In-Memory Bus Honors Distributed Semantics  ← DEC-004
  DEC-006  In-Memory Registry (only socket primitive)  ← DEC-001, DEC-004
  DEC-008  Topic URI Scheme market://venue/book/sym    ← DEC-007
  DEC-010  Sequence-Gap Detection + Resync             ← DS-COINBASE-WS, DEC-009
  DEC-012  Gateway WS Subscribe-Op Protocol            ← DEC-004
  DEC-022  Status Surface (HTTP + MCP parity)          ← DEC-015, DS-BRIEF

DEPTH 2
  DEC-011  Backpressure: drop-oldest + disconnect      ← DEC-006
  DEC-016  Three Deployment Variants (MODE env)        ← DEC-002, DEC-004
  DEC-019  Graceful Drain via Rebalance Hint           ← DEC-012, DEC-013
  DEC-021  Don't Reimplement Partitioned Messaging     ← DEC-005

DEPTH 3
  DEC-017  Scale Path (edge horiz, ingest vert/shard)  ← DEC-016

DEPTH 4
  DEC-018  Autoscale Signal: Active Connection Count   ← DEC-017
  DEC-024  IaC Deferred; Production Shape Documented   ← DEC-017

DEPTH 5
  DEC-020  Ship Autoscale-Ready Primitives, not Auto.  ← DEC-018, DEC-019, DS-BRIEF
```

## Impact Summary

| Decision | Depth | Depends On | Downstream | Blast |
|----------|-------|------------|------------|-------|
| DEC-001 | 0 | DS-BRIEF, DS-MCP | DEC-002, DEC-003, DEC-006 | 9 |
| DEC-002 | 1 | DEC-001 | DEC-016 | 5 |
| DEC-003 | 1 | DEC-001 | — | 0 |
| DEC-004 | 0 | DS-BRIEF | DEC-005, DEC-006, DEC-012, DEC-016 | 11 |
| DEC-005 | 1 | DEC-004 | DEC-021 | 1 |
| DEC-006 | 1 | DEC-001, DEC-004 | DEC-011 | 1 |
| DEC-007 | 0 | DS-COINBASE-WS, DS-BRIEF | DEC-008 | 1 |
| DEC-008 | 1 | DEC-007 | — | 0 |
| DEC-009 | 0 | DS-COINBASE-WS, DS-LLM-USABILITY | DEC-010 | 1 |
| DEC-010 | 1 | DS-COINBASE-WS, DEC-009 | — | 0 |
| DEC-011 | 2 | DEC-006 | — | 0 |
| DEC-012 | 1 | DEC-004 | DEC-019 | 2 |
| DEC-013 | 0 | DS-MCP, DS-LLM-USABILITY | DEC-019 | 2 |
| DEC-014 | 0 | DS-MCP | — | 0 |
| DEC-015 | 0 | DS-MCP, DS-LLM-USABILITY | DEC-022 | 1 |
| DEC-016 | 2 | DEC-002, DEC-004 | DEC-017 | 4 |
| DEC-017 | 3 | DEC-016 | DEC-018, DEC-024 | 3 |
| DEC-018 | 4 | DEC-017 | DEC-020 | 1 |
| DEC-019 | 2 | DEC-012, DEC-013 | DEC-020 | 1 |
| DEC-020 | 5 | DEC-018, DEC-019, DS-BRIEF | — | 0 |
| DEC-021 | 2 | DEC-005 | — | 0 |
| DEC-022 | 1 | DEC-015, DS-BRIEF | — | 0 |
| DEC-023 | 0 | DS-LLM-USABILITY, DS-BRIEF | — | 0 |
| DEC-024 | 4 | DEC-017 | — | 0 |

**Highest blast** (revisiting these cascades widely):
- **DEC-004** (Three Seams) — blast 11 — touches every component that consumes Bus / OrderBookStore / Registry.
- **DEC-001** (TS on Node) — blast 9 — language change cascades through framework, monorepo, and all downstream tech choices.
- **DEC-002** (NestJS) — blast 5 — composition framework affects all variants and the autoscale primitive shape.

**Zero-blast leaves** (safe to revisit in isolation):
DEC-003, DEC-008, DEC-010, DEC-011, DEC-014, DEC-020, DEC-021, DEC-022, DEC-023, DEC-024.

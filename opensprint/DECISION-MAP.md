# Decision Map

## Decision Tree

Layered by depth. Each ADR is shown with its direct dependencies. Driver-specs are roots (DS-*); ADRs are leaves and inner nodes (DEC-*).

```
DRIVER SPECS (roots)
  DS-BRIEF                Silver 8 Take-Home Brief
  DS-COINBASE-WS          Coinbase WebSocket Protocol
  DS-MCP                  Model Context Protocol
  DS-LLM-USABILITY        LLM as First-Class Consumer
  DS-OPERATOR-USABILITY   Operator Usability (parallel to LLM-USABILITY)

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
  DEC-030  Topic Catalog as VenueAdapter Capability    ← DEC-007, DS-LLM-USABILITY, DS-OPERATOR-USABILITY

DEPTH 2
  DEC-011  Backpressure: drop-oldest + disconnect      ← DEC-006
  DEC-016  Three Deployment Variants (MODE env)        ← DEC-002, DEC-004
  DEC-019  Graceful Drain via Rebalance Hint           ← DEC-012, DEC-013
  DEC-021  Don't Reimplement Partitioned Messaging     ← DEC-005
  DEC-025  Dashboard as Production-Foundation Surface  ← DS-OPERATOR-USABILITY, DEC-022
  DEC-027  Demand-Driven Upstream Lifecycle            ← DEC-007, DEC-005, DEC-006
  DEC-028  Realistic Coinbase Mock from Captures       ← DS-COINBASE-WS, DEC-010
  DEC-031  Catalog Source: Hardcoded Pairs (v1)        ← DEC-030, DS-COINBASE-WS
  DEC-032  /status + list_topics: Catalog vs Active    ← DEC-030, DEC-022, DEC-015

DEPTH 3
  DEC-017  Scale Path (edge horiz, ingest vert/shard)  ← DEC-016
  DEC-026  Dashboard Data Plane (HTTP poll + WS)       ← DEC-025, DEC-012, DEC-022
  DEC-033  Catalog Readiness Gates /readyz             ← DEC-030, DEC-031

DEPTH 4
  DEC-018  Autoscale Signal: Active Connection Count   ← DEC-017
  DEC-024  IaC Deferred; Production Shape Documented   ← DEC-017

DEPTH 5
  DEC-020  Ship Autoscale-Ready Primitives, not Auto.  ← DEC-018, DEC-019, DS-BRIEF
  DEC-029  Integration Test Infrastructure (compose)   ← DEC-027, DEC-028, DEC-024

DEPTH 6
  DEC-034  CI-Friendly E2E via Native Node Processes   ← DEC-029, DS-OPERATOR-USABILITY
```

## Impact Summary

| Decision | Depth | Depends On | Downstream | Blast |
|----------|-------|------------|------------|-------|
| DEC-001 | 0 | DS-BRIEF, DS-MCP | DEC-002, DEC-003, DEC-006 | 12 |
| DEC-002 | 1 | DEC-001 | DEC-016 | 7 |
| DEC-003 | 1 | DEC-001 | — | 0 |
| DEC-004 | 0 | DS-BRIEF | DEC-005, DEC-006, DEC-012, DEC-016 | 14 |
| DEC-005 | 1 | DEC-004 | DEC-021, DEC-027 | 4 |
| DEC-006 | 1 | DEC-001, DEC-004 | DEC-011, DEC-027 | 4 |
| DEC-007 | 0 | DS-COINBASE-WS, DS-BRIEF | DEC-008, DEC-027, DEC-030 | 8 |
| DEC-008 | 1 | DEC-007 | — | 0 |
| DEC-009 | 0 | DS-COINBASE-WS, DS-LLM-USABILITY | DEC-010 | 4 |
| DEC-010 | 1 | DS-COINBASE-WS, DEC-009 | DEC-028 | 3 |
| DEC-011 | 2 | DEC-006 | — | 0 |
| DEC-012 | 1 | DEC-004 | DEC-019, DEC-026 | 3 |
| DEC-013 | 0 | DS-MCP, DS-LLM-USABILITY | DEC-019 | 2 |
| DEC-014 | 0 | DS-MCP | — | 0 |
| DEC-015 | 0 | DS-MCP, DS-LLM-USABILITY | DEC-022, DEC-032 | 4 |
| DEC-016 | 2 | DEC-002, DEC-004 | DEC-017 | 6 |
| DEC-017 | 3 | DEC-016 | DEC-018, DEC-024 | 5 |
| DEC-018 | 4 | DEC-017 | DEC-020 | 1 |
| DEC-019 | 2 | DEC-012, DEC-013 | DEC-020 | 1 |
| DEC-020 | 5 | DEC-018, DEC-019, DS-BRIEF | — | 0 |
| DEC-021 | 2 | DEC-005 | — | 0 |
| DEC-022 | 1 | DEC-015, DS-BRIEF | DEC-025, DEC-026, DEC-032 | 3 |
| DEC-023 | 0 | DS-LLM-USABILITY, DS-BRIEF | — | 0 |
| DEC-024 | 4 | DEC-017 | DEC-029 | 2 |
| DEC-025 | 2 | DS-OPERATOR-USABILITY, DEC-022 | DEC-026 | 1 |
| DEC-026 | 3 | DEC-025, DEC-012, DEC-022 | — | 0 |
| DEC-027 | 2 | DEC-007, DEC-005, DEC-006 | DEC-029 | 2 |
| DEC-028 | 2 | DS-COINBASE-WS, DEC-010 | DEC-029 | 2 |
| DEC-029 | 5 | DEC-027, DEC-028, DEC-024 | DEC-034 | 1 |
| DEC-030 | 1 | DEC-007, DS-LLM-USABILITY, DS-OPERATOR-USABILITY | DEC-031, DEC-032, DEC-033 | 3 |
| DEC-031 | 2 | DEC-030, DS-COINBASE-WS | DEC-033 | 1 |
| DEC-032 | 2 | DEC-030, DEC-022, DEC-015 | — | 0 |
| DEC-033 | 3 | DEC-030, DEC-031 | — | 0 |
| DEC-034 | 6 | DEC-029, DS-OPERATOR-USABILITY | — | 0 |

**Highest blast** (revisiting these cascades widely):
- **DEC-004** (Three Seams) — blast **14** — touches every component plus the lifecycle and CI ADRs.
- **DEC-001** (TS on Node) — blast **12** — language change cascades through framework, monorepo, lifecycle, deployment, and CI.
- **DEC-007** (Venue Adapter) — blast **8** — parents the catalog initiative + lifecycle chain.
- **DEC-002** (NestJS) — blast **7** — composition framework affects all variants and downstream.
- **DEC-016** (Three deployment variants) — blast **6** — owns MODE-selected composition, scale, integration test, and CI path.

**New-initiative entries** (`topic-catalog`):
- **DEC-030** — Catalog as VenueAdapter capability (the structural commitment; depth 1).
- **DEC-031** — Hardcoded common pairs for v1; REST discovery deferred (the operational policy).
- **DEC-032** — `/status` + `list_topics` catalog/active split (light evolution of DEC-022 and DEC-015; both remain active).
- **DEC-033** — Adapter catalog readiness gates `/readyz` (extends DEC-020's readiness contract).

**New-initiative entries** (`github-ci-e2e`):
- **DEC-034** — CI-friendly e2e via native Node processes; DEC-029's Docker recipe stays as the local + production-deployment shape.

**Zero-blast leaves** (safe to revisit in isolation):
DEC-003, DEC-008, DEC-011, DEC-014, DEC-020, DEC-021, DEC-023, DEC-026, DEC-032, DEC-033, DEC-034.

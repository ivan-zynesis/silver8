---
id: topic-catalog
status: active
created: 2026-05-05
parent: market-data-hub
---

## Description

Make **topic catalog a first-class capability of the `VenueAdapter`**, distinct from active/warm topics, so cold-start agents and operators can discover what's askable before any consumer has subscribed. Resolves the chicken-and-egg the demand-driven upstream lifecycle (DEC-027) exposed: with no eager pre-subscription, a cold hub has no maintained order books → `/status` shows empty topics → dashboard has nothing to offer for selection → no consumer ever subscribes → catalog stays empty.

The brief does not require this — a hardcoded set of common pairs in the dashboard's HTML would technically satisfy the assessment. We pay the marginal cost for **architectural correctness**: the seam DEC-007 promised — that adding a venue is a simple exercise — is incomplete if every new venue must reinvent how the system discovers what it offers.

## Driver Specs

- DS-BRIEF (parent context — multi-venue extensibility is the load-bearing requirement)
- DS-LLM-USABILITY (cold `list_topics()` must work for a fresh agent)
- DS-OPERATOR-USABILITY (dashboard shows available choices, not just active topics)
- DS-COINBASE-WS (catalog source for the Coinbase adapter sits adjacent to its WS protocol concerns)

No new driver-specs.

## ADRs

- DEC-030 — Topic Catalog as VenueAdapter Capability *(new)*
- DEC-031 — Catalog Source: Hardcoded Common Pairs for v1; REST Discovery Deferred *(new)*
- DEC-032 — `/status` and `list_topics` — Catalog vs Active Split *(new)*
- DEC-033 — Adapter Catalog Readiness Gates `/readyz` *(new)*

Existing ADRs that remain load-bearing for this initiative: DEC-007 (venue adapter pattern), DEC-012 (WS gateway protocol), DEC-015 (MCP tool surface), DEC-020 (autoscale-ready primitives, including `/readyz`), DEC-022 (status surface), DEC-027 (demand-driven lifecycle — the mechanism that exposed the gap).

## Milestones

- [x] **catalog-as-adapter-capability**: `TopicDescriptor` and `VenueAdapterCatalog` interfaces in `@silver8/core`. `CoinbaseAdapter` ships `COINBASE_DEFAULT_SYMBOLS` hardcoded constant (BTC-USD, ETH-USD, SOL-USD, AVAX-USD, DOGE-USD, XRP-USD, LINK-USD, MATIC-USD) and implements the catalog interface. `IngestionModule` exposes `VENUE_ADAPTER_CATALOG` DI token. `/status` payload renamed `topics` → `active` and adds `catalog`; HTTP and MCP parity preserved. MCP `list_topics`, `describe_topic`, resource registration, and bus subscription wiring source from catalog. WS gateway rejects non-catalog subscribes with `unknown_topic` error and enumerated alternatives. `IngestionService` declares `'ingestion.catalog'` readiness component (DEC-033). Dashboard reads `status.catalog` for the symbol picker; renders separate "Active topics" + "Catalog" sections. `COINBASE_SYMBOLS` env var removed. Tests: 5 new for `coinbase-catalog`; 1 new for WS catalog-rejection; status-builder + tools tests rewritten for the split. Smoke verified end-to-end. Docs swept (overview, MCP reference, topics, failure modes, WS gateway, README). _Completed 2026-05-05; opsx change `2026-05-05-catalog-as-adapter-capability`._

## OPSX Changes

- `2026-05-05-catalog-as-adapter-capability` (archived)

## Notes

- **Cross-venue policy is out of scope.** Whether an aggregated `list_topics()` shows the union or intersection of venue catalogs (and how to handle pairs available on one venue but not another) is a separate concern that doesn't yet arise — there is one venue adapter today. A future ADR would record the policy when a second venue lands.
- **REST discovery is named and deferred** in DEC-031. Coinbase `GET /products` is the obvious upgrade — always-current catalog plus per-pair metadata hydration for `describe_topic` — but adds a dependency the brief does not reward. The ADR records the resolution path so a future maintainer doesn't relitigate the question.
- **Naming choices flagged during exploration** (resolved in the ADRs):
  - `/status` field naming: rename `topics` → `active` + add `catalog` (DEC-032). With no installed base, the rename is free.
  - Capability shape on `VenueAdapter`: extend the existing interface rather than compose a separate `CatalogProvider` (DEC-030). There is no scenario where an adapter has WS lifecycle but no catalog.
  - WS-subscribe-to-non-catalog policy: reject with enumerated helpful-error (inlined into DEC-030 rather than split into a separate DEC-034). The catalog-authoritative property is part of the same commitment.
- **Initiative is small by design**: 4 ADRs, 1 milestone, no new driver-specs. Blast radius confined to surface-area changes (status payload shape, MCP tool grounding, dashboard symbol selector, readiness gating). Seam interfaces (`Bus`, `OrderBookStore`, `Registry`) do not change.

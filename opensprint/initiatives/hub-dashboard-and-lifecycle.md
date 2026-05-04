---
id: hub-dashboard-and-lifecycle
status: active
created: 2026-05-04
parent: market-data-hub
---

## Description

Evolve the hub from the always-on, headless v1 into an observable, demand-driven, end-to-end-tested system. The methodology is the strategic spine: **always-on first → observe → convert → mock from observed → automate**. Each milestone changes one architectural axis so that when something breaks in milestone N+1, you know which decision caused it. The mock is built only after observing real Coinbase behavior, so it encodes facts not assumptions.

This initiative also closes the IaC question structurally rather than additively: the docker-compose orchestration that runs the integration tests IS the deployment recipe. Production replaces `coinbase-mock` with the real venue and replaces `docker compose` with the production orchestrator (Fly Machines, Cloud Run, Kubernetes). Same image, same env, same service topology — no separate IaC artifact required for the take-home (extending DEC-024).

## Driver Specs

- DS-BRIEF (parent context)
- DS-COINBASE-WS
- DS-OPERATOR-USABILITY *(new)*

## ADRs

- DEC-025 — Dashboard as Production-Foundation Surface *(new)*
- DEC-026 — Dashboard Data Plane (HTTP poll + WS subscribe) *(new)*
- DEC-027 — Demand-Driven Upstream Lifecycle with Tiered Grace Periods *(new; fulfills the deferred note in DEC-007)*
- DEC-028 — Realistic Coinbase Mock from Real-Session Captures *(new)*
- DEC-029 — Integration Test Infrastructure (Dockerized e2e via docker-compose) *(new; extends DEC-024)*

Existing ADRs that remain load-bearing for this initiative: DEC-007, DEC-010, DEC-012, DEC-022, DEC-024.

## Milestones

- [ ] **dashboard-mvp**: `apps/dashboard` (Vite + React + TypeScript), served by the hub at `/dashboard`. Status panel showing the `/status` payload made human-legible (uptime, mode, upstream connection state, per-topic stale/sequence/last-update, consumer counts) plus a single live book ticker for one selected symbol via WS gateway subscribe. *Always-on ingestion still in effect; the dashboard observes the always-on behavior and is the foundation for the eventual ops dashboard.*

- [ ] **demand-driven-lifecycle**: Convert ingestion to demand-driven via `Registry.onDemandChange`. Tiered grace: channel unsubscribe immediate when last consumer leaves a topic; socket close after 5 minutes of zero-channel idleness (configurable). Dashboard shows the lifecycle transitions live — the "watch the change happening" demo. Supersedes the deferred-action note in DEC-007.

- [ ] **coinbase-mock**: Capture real Coinbase sessions to fixture files; build a faithful WS server (`apps/coinbase-mock` or similar) that replays them. Honors the Advanced Trade WS protocol surface our adapter uses (`subscribe`/`unsubscribe`, `level2`, `heartbeats`, monotonic `sequence_num`). Fault-injection knobs: induce sequence gap, drop connection mid-stream, stop emitting heartbeats, slow-emit. *Mock from observed, not imagined.*

- [ ] **integration-test-suite**: `apps/integration-tests` (vitest). `docker-compose.yml` orchestrates `hub` (built from existing Dockerfile) + `coinbase-mock` as separate services. End-to-end assertions for the complete data-plane lifecycle: subscribe → upstream attach → snapshot → gap → resync → disconnect → channel unsub → idle → socket close → SIGTERM drain. The compose recipe doubles as the deployment shape — production swaps mock for real venue, dev compose for production orchestrator (closes the IaC concern without a separate milestone).

## Notes

- IaC explicitly stays out of scope per DEC-024 + the operator's reframe in this initiative's exploration: the existing Dockerfile + docker-compose constitute the application orchestration recipe; production extension is registry/orchestrator swap, not new artifacts.
- The methodology naming ("always-on first → observe → convert → mock from observed → automate") is the strategic rationale for the milestone *ordering*. Each milestone changes one axis so failures in subsequent milestones have a single suspected cause.
- Dashboard MVP is intentionally narrow (status panel + one book ticker). Richer views — connection event log, per-consumer detail, message-rate graph, multi-symbol panels — are follow-up scope, not v1 scope. Demonstrates agile incrementalism.
- Configuration of grace periods (channel idle = 0; socket idle = 5min default) becomes part of the env schema established in M1's ConfigModule pattern.

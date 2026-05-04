---
id: hub-dashboard-and-lifecycle
status: complete
created: 2026-05-04
completed: 2026-05-04
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

- [x] **dashboard-mvp**: `apps/dashboard` (Vite + React + TypeScript), served by the hub at `/dashboard`. Status panel rendering the `/status` payload (uptime, mode, upstream state, per-topic stale/sequence/last-update, consumer counts) plus a single live book ticker via WS gateway subscribe. *Completed 2026-05-04; live smoke verified asset serving at 200; foundation for the ops dashboard is in place.*

- [x] **demand-driven-lifecycle**: Ingestion converted to demand-driven via `Registry.onDemandChange`. Tiered grace: channel unsubscribe immediate; socket close after `INGESTION_SOCKET_IDLE_MS` of zero-channel idleness (default 300s, configurable). Status surface gained `subscribedChannels` and `lifecycle` fields; dashboard shows the lifecycle transitions. Fulfills the deferred-action note in DEC-007. *Completed 2026-05-04; live smoke confirmed transitions T0→T1→T2 + socket idle close.*

- [x] **coinbase-mock**: `apps/coinbase-mock` ships with: JSONL fixture loader, per-connection ConnectionReplay with monotonic sequence rewriting + subscription filtering, WS server speaking Advanced Trade protocol, control plane (HTTP) for fault injection — `/control/inject-gap`, `/control/disconnect`, `/control/silence`, `/control/slow`, `/control/state`. Synthetic baseline fixture covers BTC-USD + ETH-USD; recorder script for real captures ships as a developer tool. *Completed 2026-05-04; 16 unit tests; live smoke proved end-to-end mock → hub → consumer chain (snapshot bid=67499.5 ask=67500.5 + 9 updates in 1.5s).*

- [x] **integration-test-suite**: `apps/integration-tests` (vitest) + `docker-compose.integration.yml`. Helpers wrap docker compose lifecycle, hub HTTP/WS, and mock control plane. Four end-to-end assertions cover subscribe→attach→snapshot, channel unsub immediate→socket idle close, sequence gap→stale→resync, upstream disconnect→reconnect. Suite is opt-in via `INTEGRATION_DOCKER=1`; default behavior skips with a clear message so `pnpm test` stays fast in non-Docker environments. *Completed 2026-05-04; the compose recipe IS the deployment shape (DEC-029 extending DEC-024).*

## Notes

- IaC explicitly stays out of scope per DEC-024 + the operator's reframe in this initiative's exploration: the existing Dockerfile + docker-compose constitute the application orchestration recipe; production extension is registry/orchestrator swap, not new artifacts.
- The methodology naming ("always-on first → observe → convert → mock from observed → automate") is the strategic rationale for the milestone *ordering*. Each milestone changes one axis so failures in subsequent milestones have a single suspected cause.
- Dashboard MVP is intentionally narrow (status panel + one book ticker). Richer views — connection event log, per-consumer detail, message-rate graph, multi-symbol panels — are follow-up scope, not v1 scope. Demonstrates agile incrementalism.
- Configuration of grace periods (channel idle = 0; socket idle = 5min default) becomes part of the env schema established in M1's ConfigModule pattern.

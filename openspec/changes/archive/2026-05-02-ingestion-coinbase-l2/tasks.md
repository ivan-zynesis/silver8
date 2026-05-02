# Tasks — ingestion-coinbase-l2

- [x] Coinbase wire types
- [x] Coinbase message parser → normalized (8 tests)
- [x] BookMaintainer: snapshot/update → OrderBookStore + Bus publish, with stale→fresh transition
- [x] CoinbaseProtocolHandler: parses, applies, detects sequence gaps, calls back for resync (6 tests)
- [x] CoinbaseAdapter: WS lifecycle, subscribe/unsubscribe, heartbeat watchdog, exponential reconnect, gap-driven resubscribe
- [x] IngestionService: orchestrates lifecycle (start/stop), reports readiness via ReadinessReporter, exposes status
- [x] IngestionModule: real `forRoot` replacing M1 stub; marked global so StatusController can inject IngestionService
- [x] Hub readiness: ingestion declares the `ingestion` component; flips to ready on first snapshot
- [x] Status enrichment: `upstream.coinbase` block now appears in /status with status, connectedAt, symbols, booksKnown
- [x] ReadinessReporter contract added to @silver8/core; HttpModule provides via ReadinessService.

Deferred (architectural surface preserved, not exercised in v1):
- DemandDriver acting on Registry demand-change to dynamically (un)sub upstream — refcount semantics are tested in core-memory.

## Verification

- `pnpm vitest run` → 6 files, 51 tests passed.
- `npx tsc -b apps/hub` → clean build.
- Live boot in MODE=monolith with stub Coinbase URL: /status surfaces upstream.coinbase, /readyz returns 503 until snapshot received (correct gating).
- Composition variants (ingestion-mode, gateway-mode) unchanged — still fail fast with CompositionError.


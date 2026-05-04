# Integration Test Suite (Dockerized e2e via docker-compose)

**Initiative:** hub-dashboard-and-lifecycle
**Milestone:** 4/4

## What

Stand up `apps/integration-tests` — a vitest-driven test package that orchestrates the hub + the Coinbase mock as separate containers via `docker-compose`, and asserts the complete data-plane lifecycle end-to-end.

The same compose recipe doubles as the deployment shape (extending DEC-024): production replaces `coinbase-mock` with the real venue and replaces `docker compose` with the production orchestrator.

## References

- DEC-029 (integration test infrastructure as Dockerized e2e via compose) — primary
- DEC-027 (demand-driven lifecycle — what we assert)
- DEC-028 (mock fidelity — what we run against)
- DEC-024 (IaC — extended by treating compose as deployment recipe)

## Approach

### Compose topology

`docker-compose.integration.yml` defines two services:

```
services:
  coinbase-mock:
    build: { context: ., dockerfile: apps/coinbase-mock/Dockerfile }
    ports: ["8765:8765", "8766:8766"]
    environment: { MOCK_RATE_HZ: 20, MOCK_LOOP: "true" }

  hub:
    build: { context: ., dockerfile: Dockerfile }
    depends_on:
      coinbase-mock: { condition: service_started }
    environment:
      MODE: monolith
      INGESTION_LIFECYCLE: demand_driven
      INGESTION_SOCKET_IDLE_MS: 2000
      COINBASE_WS_URL: ws://coinbase-mock:8765
      COINBASE_SYMBOLS: BTC-USD,ETH-USD
    ports: ["3000:3000", "3001:3001"]
```

Each service has its own Dockerfile. The hub already has one; we add `apps/coinbase-mock/Dockerfile`. Both build from the workspace root for shared lockfile / monorepo deps.

### Test runner

`apps/integration-tests/src/lifecycle.test.ts` — vitest suite. `beforeAll` runs `docker compose up -d` and waits for `/readyz`; `afterAll` runs `docker compose down`. Each test interacts with the hub via WS and HTTP, and with the mock via its control plane (HTTP at 8766).

### Test shapes

The suite covers the lifecycle assertions named in DEC-029:

1. **Subscribe → upstream attach → snapshot delivered.** Connect WS, subscribe BTC-USD, expect `snapshot` event; assert `/status` shows the channel subscribed.
2. **Inject sequence gap → topic stale → resync → fresh.** While receiving updates, POST to the mock's `/control/inject-gap`; expect `stale` event (or topic to flip stale on `/status`); shortly after, expect resync recovery.
3. **Disconnect → channel unsub → idle → socket close.** Disconnect WS, observe `subscribedChannels=[]` immediately, then after `INGESTION_SOCKET_IDLE_MS` observe `upstream.coinbase.status=idle`.
4. **Mid-stream upstream disconnect → reconnect → resume.** POST to mock's `/control/disconnect`; observe topic stale; observe automatic reconnect.

### Skip/run gating

The suite checks that Docker is available before running. If not, every test marks itself as skipped with a clear message ("requires docker compose"). The package's `test` script runs vitest with `--passWithNoTests`-equivalent behavior so `pnpm test` from the root doesn't break in non-Docker environments.

For development convenience, an env var (`SKIP_DOCKER_BUILD=1`) lets the suite reuse pre-built images instead of rebuilding every run.

## Tests

The suite IS the tests. Internal targets:
- Lifecycle tests as described above (4 test cases).
- Helper utilities: `composeUp()`, `composeDown()`, `waitForReady()`, `wsConnect()`, `injectGap()`.

## Non-goals

- Replacing component-level unit tests (those continue to run as before).
- Performance / load testing (separate workstream).
- CI integration (the suite is locally runnable; CI integration is operational, not architectural).

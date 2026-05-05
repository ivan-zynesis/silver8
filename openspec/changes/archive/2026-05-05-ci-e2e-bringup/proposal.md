# CI-Friendly E2E Bringup

**Initiative:** github-ci-e2e
**Milestone:** 1/2

## What

Make the integration test suite (`apps/integration-tests`) bring up the hub + Coinbase mock stack in two modes — Docker (existing, unchanged) or native Node child processes (new) — selected by an `INTEGRATION_BRINGUP` env var. The test bodies stay identical: they exercise the same protocol surfaces against the same mock fixtures, regardless of how the listening processes were spawned. CI gets fast (~5s vs 60s+) bringup; local dev keeps the production-shape Docker recipe by default.

## References

- DEC-034 — CI-Friendly E2E via Native Node Processes (primary)
- DEC-029 — Integration Test Infrastructure (Docker-compose; remains canonical for local + production deployment shape)
- DS-OPERATOR-USABILITY — test infra is part of the system; CI is the bot operator

## Approach

### Bringup switcher

`apps/integration-tests/src/helpers.ts` gains a mode dispatcher:

```typescript
type Bringup = 'docker' | 'process';

function resolveBringup(): Bringup | null {
  const explicit = process.env.INTEGRATION_BRINGUP;
  if (explicit === 'docker' || explicit === 'process') return explicit;
  // Backward-compat: legacy gate from M4.
  if (process.env.INTEGRATION_DOCKER === '1') return 'docker';
  // Auto-default: in CI environments, prefer the fast process path.
  if (process.env.CI) return 'process';
  return null;  // no opt-in → suite skipped
}
```

`stackUp()` / `stackDown()` (renamed from `composeUp` / `composeDown`) dispatch to the underlying implementation. Existing Docker logic is renamed `dockerComposeUp` / `dockerComposeDown` (private). New `processUp` / `processDown` spawn `apps/coinbase-mock/dist/main.js` and `apps/hub/dist/main.js` as Node child processes, configured via env to match the ports the test fixtures already expect (3000 / 3001 / 8765 / 8766). `processDown` SIGTERMs both children, with a 3-second SIGKILL fallback.

`bringupAvailable()` (renamed from `dockerAvailable()`) returns `true` if a bringup mode is resolvable; in `docker` mode it additionally verifies `docker compose version` and `docker info` exit 0.

### Process bringup details

- Hub talks to mock via `ws://127.0.0.1:8765` (vs `ws://coinbase-mock:8765` in Docker).
- Both children get `cwd = REPO_ROOT` so `apps/dashboard/dist` resolution in the hub still works (its `resolveDashboardDist()` walks relative to `import.meta.url` which lives in `apps/hub/dist`).
- stdio is captured (last 80 lines per child) and surfaced on failure for diagnosis. Routine output is discarded to keep the test runner quiet.
- Ports are hardcoded to match the existing `HUB_HTTP` / `HUB_WS` / `MOCK_CONTROL` constants — no test-body changes needed.
- Hub env: `MODE=monolith HTTP_PORT=3000 WS_PORT=3001 MCP_TRANSPORT=http LOG_LEVEL=warn INGESTION_LIFECYCLE=demand_driven INGESTION_SOCKET_IDLE_MS=2000 COINBASE_WS_URL=ws://127.0.0.1:8765 DRAIN_DEADLINE_MS=5000`. Mirrors `docker-compose.integration.yml`.
- Mock env: `MOCK_WS_PORT=8765 MOCK_CONTROL_PORT=8766 MOCK_LOOP=true MOCK_RATE_HZ=20`.
- Pre-flight: error fast with a clear message if `dist/main.js` is missing for either app (operator hasn't run `pnpm -r build`).

### Package scripts

```json
"test:e2e":    "INTEGRATION_BRINGUP=docker vitest run",
"test:ci-e2e": "INTEGRATION_BRINGUP=process vitest run"
```

`test:e2e` keeps the same intent (Docker bringup) — the env var name changes from `INTEGRATION_DOCKER` to `INTEGRATION_BRINGUP`, with `INTEGRATION_DOCKER=1` honored as a backward-compat alias.

## Tests

- The same 4 `lifecycle.test.ts` cases run under each bringup. Test bodies and helper imports are unchanged except for the `composeUp`/`composeDown` rename (call sites updated to `stackUp`/`stackDown`).
- Verified locally:
  - `pnpm test:e2e` — 4/4 ✓ (Docker path)
  - `pnpm test:ci-e2e` — 4/4 ✓ (process path)
  - `pnpm test` (unit suite, no bringup env) — integration tests skip with the existing "set `INTEGRATION_BRINGUP` to opt in" message.

## Non-goals

- GitHub Actions workflow itself (M2 of this initiative).
- Additional fault-injection scenarios (existing 4 tests are sufficient for the bringup-equivalence claim).
- Changing test fixtures, ports, or the mock's behavior.
- Linting / audit / Dependabot — out of scope per operator (initiative notes).

## What's lost / migration

- `INTEGRATION_DOCKER=1` environment variable is replaced by `INTEGRATION_BRINGUP=docker` as the canonical opt-in for the Docker path. The old name still works (logged once on startup, treated as `docker`) so existing local muscle memory and any external CI scripts keep functioning.
- `composeUp` / `composeDown` / `dockerAvailable` are renamed in `helpers.ts`. They are internal to `apps/integration-tests` and not exported.

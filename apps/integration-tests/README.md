# Integration Tests

End-to-end test suite for the silver8 hub. Orchestrates the hub + the Coinbase
mock as separate services and asserts the complete data-plane lifecycle.

The suite supports **two bringup modes** (DEC-029, DEC-034):

| Mode | When | What it spins up |
|---|---|---|
| `docker`  | local dev, deployment-shape verification | `docker-compose.integration.yml` — same recipe as production |
| `process` | CI, fast iteration | Native Node child processes spawned from each app's `dist/main.js` |

The same vitest test bodies run under both modes. Tests assert against
`localhost:3000`, `localhost:3001`, and `localhost:8766` regardless of how
those listeners came up.

## What it covers

- **Subscribe → upstream attach → snapshot delivered** (DEC-027 channel-level grace).
- **Disconnect → channel unsub → idle → socket close** (DEC-027 socket-level grace).
- **Sequence gap → topic stale → automatic resync → fresh** (DEC-010 + DEC-028 fault injection).
- **Upstream disconnect → automatic reconnect → service resumes** (DEC-007 reconnect + DEC-028).
- **MCP HTTP: initialize → subscribe → notification arrives** (DEC-035 stateful streamable HTTP — exercises session id, GET-opened SSE stream, and `notifications/resources/updated` delivery).

## Running

The suite is **opt-in**. Default `pnpm test` runs the unit suite and marks
the integration tests as skipped (with a helpful message). To run:

```bash
# Docker bringup — production-shape, requires Docker Desktop + compose v2.
pnpm --filter @silver8/integration-tests run test:e2e

# Process bringup — native Node child processes, no Docker needed. ~5s.
pnpm -r build  # required: process bringup spawns dist/main.js artifacts
pnpm --filter @silver8/integration-tests run test:ci-e2e
```

In **CI environments** (any provider that sets `CI=true`), the process bringup
is auto-selected. The GitHub Actions workflow at
[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) runs `pnpm test:ci-e2e`
directly as the `Integration tests (process bringup)` step.

### Mode resolution

The bringup mode is resolved at suite start, in this order:

1. `INTEGRATION_BRINGUP=docker|process` — explicit override.
2. `INTEGRATION_DOCKER=1` — legacy alias for `docker`.
3. `CI` env truthy → defaults to `process`.
4. Otherwise → suite skipped.

### Speedups (Docker mode)

After a first build, skip rebuilds for fast iteration:

```bash
INTEGRATION_BRINGUP=docker SKIP_DOCKER_BUILD=1 pnpm --filter @silver8/integration-tests run test:e2e
```

## Why two modes

**Docker** is canonical: per DEC-029, the same `docker-compose.integration.yml`
IS the deployment shape — production replaces `coinbase-mock` with the real
venue and replaces `docker compose` with the production orchestrator (Fly
Machines, Cloud Run, k8s). Same image, same env, same service topology.

**Process** is fast: per DEC-034, GitHub Actions runners pay 1–3 minutes per
PR for Docker bringup. Native Node child processes spawn the same artifacts
in ~5s. This catches everything except Dockerfile / runtime-image-layout
regressions, which are caught locally on every Docker run and in any PR
that touches the Dockerfile.

## Why opt-in by default

Integration tests need a bringup mode. Local `pnpm test` runs unit tests
fast and stays non-flaky in environments without Docker / without dist
artifacts; operators explicitly opt in (or the CI env auto-selects) when
they want the e2e assertions.

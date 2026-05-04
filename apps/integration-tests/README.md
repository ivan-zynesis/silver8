# Integration Tests

End-to-end test suite for the silver8 hub. Orchestrates the hub + the Coinbase
mock as separate services via `docker-compose.integration.yml` (at the repo
root) and asserts the complete data-plane lifecycle.

This is the M4 deliverable for the `hub-dashboard-and-lifecycle` initiative
and the literal embodiment of DEC-029.

## What it covers

- **Subscribe → upstream attach → snapshot delivered** (DEC-027 channel-level grace).
- **Disconnect → channel unsub → idle → socket close** (DEC-027 socket-level grace).
- **Sequence gap → topic stale → automatic resync → fresh** (DEC-010 + DEC-028 fault injection).
- **Upstream disconnect → automatic reconnect → service resumes** (DEC-007 reconnect + DEC-028).

## Running

The suite is **opt-in**. Default `pnpm test` runs everything else and marks
the integration tests as skipped (with a helpful message). To run:

```bash
# Requires Docker Desktop / `docker compose` v2 with a working daemon.
INTEGRATION_DOCKER=1 pnpm --filter @silver8/integration-tests test:e2e

# Or, after a first build, skip rebuilds for faster iteration:
INTEGRATION_DOCKER=1 SKIP_DOCKER_BUILD=1 pnpm --filter @silver8/integration-tests test:e2e
```

Behind the scenes the suite runs:

```
docker compose -f docker-compose.integration.yml up -d --wait [--build]
# ...vitest assertions...
docker compose -f docker-compose.integration.yml down -v --timeout 5
```

The compose file mounts:

- `coinbase-mock` on `:8765` (WS) and `:8766` (control plane).
- `hub` on `:3000` (HTTP) and `:3001` (WS gateway), pointed at
  `ws://coinbase-mock:8765` and configured `INGESTION_LIFECYCLE=demand_driven`.

## Why this is the deployment recipe

Per DEC-029, the same compose IS the deployment shape — production replaces
the `coinbase-mock` service with the real venue (configured via
`COINBASE_WS_URL`) and replaces `docker compose` with the production
orchestrator (Fly Machines, Cloud Run, k8s). Same image, same env, same
service topology. The suite proves the recipe works.

## Why opt-in by default

Integration tests need Docker. CI sandboxes, freshly-cloned machines, and
quick local edits often don't have it ready. Defaulting to skip keeps
`pnpm test` fast and non-flaky; operators explicitly opt in when they want
the e2e assertions.

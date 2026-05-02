# Docs + Container Packaging + Architecture Write-up

**Initiative:** market-data-hub
**Milestone:** 5/5

## What

Treat documentation as a first-class deliverable (DEC-023). Ship `/docs` structured for LLM consumption, a multi-stage Dockerfile, docker-compose for local dev, and a one-page architecture write-up.

## References

- DEC-023 (docs as first-class deliverable, LLM-targeted structure)
- DEC-024 (production deployment shape documented)
- DS-BRIEF deliverables: `/docs`, README, architecture write-up

## Deliverables

```
docs/
  00-overview.md            Purpose, scope, non-goals
  01-getting-started.md     Connect via MCP HTTP+SSE / stdio + WS
  02-mcp-tool-reference.md  Per-tool reference with worked examples
  03-mcp-resources.md       Resource URI scheme + resources/subscribe lifecycle
  04-topics.md              Per-topic schema, cadence, real example payload
  05-worked-examples.md     End-to-end agent flows
  06-failure-modes.md       Stale, lagged, rebalance, unknown symbol
  07-ws-gateway.md          WS protocol op/event reference
  08-architecture.md        One-page architecture write-up
README.md                   Repo entry point: 5-min get-started + links
Dockerfile                  Multi-stage build, distroless final
docker-compose.yml          Local dev, single hub container
.dockerignore
```

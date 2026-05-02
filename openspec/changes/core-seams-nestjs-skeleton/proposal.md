# Core Seams + NestJS Skeleton

**Initiative:** market-data-hub
**Milestone:** 1/5

## What

Stand up the monorepo, define the three architectural seams as interfaces, ship in-memory implementations honoring distributed semantics, wire up NestJS with three-variant composition, and provide the autoscale-ready observability primitives.

## References

- DEC-001 (TS+Node), DEC-002 (NestJS+Fastify), DEC-003 (pnpm+Turborepo)
- DEC-004 (three seams), DEC-005 (in-memory Bus semantics), DEC-006 (in-memory Registry hazards)
- DEC-016 (three deployment variants), DEC-020 (autoscale-ready primitives)

## Deliverables

1. Repo root config: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.nvmrc`, `.gitignore`
2. `packages/core/` — interfaces (`Bus`, `OrderBookStore`, `Registry`), domain types, errors
3. `packages/core-memory/` — `InMemoryBus`, `InMemoryOrderBookStore`, `InMemoryRegistry` with required semantics
4. `packages/observability/` — Pino logger factory
5. `apps/hub/` — NestJS app with `MODE`-selected composition, Fastify HTTP adapter, `/healthz`, `/readyz`, `/metrics`, `/status`, SIGTERM drain hook
6. Tests: Bus semantics suite; Registry churn / slow-consumer / storm fixtures (Bus + Registry only — adapters tested in their own milestones)

## Non-goals

- Coinbase adapter (M2)
- WS gateway protocol (M3)
- MCP server (M4)
- Docs and Dockerfile (M5)

The M2/M3/M4 packages are scaffolded as empty Nest modules so the composition root can reference them.

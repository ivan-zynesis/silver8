---
id: DS-OPERATOR-USABILITY
name: Operator Usability
type: quality
status: active
created: 2026-05-04
---

## Summary

The hub must be legible to a **human operator** running, debugging, or extending it — not only to LLM consumers (DS-LLM-USABILITY) and engineers reading code. Operator usability is a quality attribute on par with LLM usability: both shape the system's surfaces, but they target different audiences.

## What it drives

- **Live dashboard**: `/status` is machine-readable; the dashboard makes the same data human-legible. Connection counts, upstream health, per-topic stale flags, live book ticks, lifecycle transitions are visible without needing to `curl | jq`.
- **Observable lifecycle transitions**: when the demand-driven upstream subscription opens or closes, the operator can *see* it in real time. Behavior changes are not silent.
- **Deterministic test harness**: integration tests run against a controlled environment (Coinbase mock + Docker-compose). An operator can reproduce production-shaped failure modes locally without flaky network dependencies.
- **Recipe-as-deployment**: the same `docker-compose.yml` that runs the integration tests is the shape of the deployment artifact. An operator who can run the tests can deploy the system; the orchestrator (Fly / Cloud Run / k8s) is a swap, not a redesign.

## How To Apply

- When designing new surfaces, ask: *can a human operator see what's happening through this?* If the answer is "only by reading logs at debug level," the surface is incomplete.
- Every state transition that affects behavior (consumer attach/detach, upstream connect/disconnect, drain initiated) should be visible somewhere — dashboard, status, structured log, or all three.
- Test infrastructure is part of the system, not a separate concern. Tests should be operator-runnable with one command (`pnpm test:e2e` or `docker compose up`) and produce understandable output.

## Relationship to DS-LLM-USABILITY

Both attributes shape the data plane and the documentation, but at different points:

| | DS-LLM-USABILITY | DS-OPERATOR-USABILITY |
|---|---|---|
| Audience | LLM agents driving tools | Humans running the hub |
| Surface | MCP tools + `/docs` | Dashboard + `/status` + structured logs |
| Quality test | "Can a fresh agent succeed first try?" | "Can a fresh operator diagnose a fault?" |

The two are reinforcing — actionable error messages serve both audiences; consistent URI schemes serve both; observable lifecycle transitions serve both.

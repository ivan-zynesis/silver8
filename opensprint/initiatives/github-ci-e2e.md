---
id: github-ci-e2e
status: active
created: 2026-05-05
parent: market-data-hub
---

## Description

Bring the integration test suite into GitHub Actions so every pull request and push-to-main runs the same e2e tests that exercise the demand-driven lifecycle, gap recovery, and reconnect flows. The Docker-compose recipe stays the canonical local-dev and production-deployment shape (DEC-029); CI gets a parallel bringup path that runs the same test bodies as native Node child processes for fast feedback.

The integration suite previously required `INTEGRATION_DOCKER=1` and a working Docker daemon. After this initiative, it auto-detects CI environments and bringup-mode-switches accordingly, so an operator's mental model is "tests run the right way wherever they run" — `pnpm test:e2e` locally uses Docker (production-shape), `pnpm test:ci-e2e` (or any run with `CI=true`) uses native processes (CI-fast).

## Driver Specs

- DS-OPERATOR-USABILITY (test infrastructure is part of the system; tests must be operator-runnable with one command and produce understandable output — CI is the bot operator)
- DS-BRIEF (production-shaped code: tests, CI, structured logs, configuration files, Dockerfile, README)

No new driver-specs.

## ADRs

- DEC-034 — CI-Friendly E2E via Native Node Processes *(new)*

Existing ADRs that remain load-bearing for this initiative:

- DEC-029 — Integration Test Infrastructure (Dockerized e2e via docker-compose) — the canonical local + production-deployment shape, unchanged by this initiative.
- DEC-027 — Demand-Driven Upstream Lifecycle — the behavior the e2e suite validates.
- DEC-028 — Realistic Coinbase Mock from Real-Session Captures — the mock used in both bringup paths.

## Milestones

- [ ] **ci-e2e-bringup**: Refactor `apps/integration-tests/src/helpers.ts` to support two bringup modes — `docker` (existing `composeUp`/`composeDown`, unchanged) and `process` (new — spawns `apps/coinbase-mock/dist/main.js` and `apps/hub/dist/main.js` as child processes with port-isolated config, waits for healthchecks, tears down on `afterAll`). Switcher gated by `INTEGRATION_BRINGUP=docker|process`; default is `process` when the `CI` env var is truthy, else `docker`. Add `pnpm test:ci-e2e` script that sets the var explicitly so operators can run the CI path locally for diagnosis. Verified: same 4 lifecycle tests pass under both bringup paths.

- [ ] **github-actions-workflow**: Add `.github/workflows/ci.yml` triggered on `pull_request` and `push` to `main`. Steps: checkout, setup-node + setup-pnpm with caching, `pnpm install --frozen-lockfile`, `pnpm -r build`, `pnpm -r typecheck`, `pnpm -r test` (unit), `pnpm test:ci-e2e`. Status check appears on PRs. Branch-protection configuration is operator-side (GitHub UI), out of scope.

## Notes

- This initiative is small by design: 1 new ADR, 0 new driver-specs, 2 milestones. Blast radius confined to `apps/integration-tests/` and a new `.github/workflows/` file. No production code changes.
- DEC-029 is augmented with a sibling test path, not invalidated. Both paths exercise the same protocol surfaces against the same mock fixtures; they differ only in how the listening processes are spawned. The Dockerfile, docker-compose.yml, and docker-compose.integration.yml are all unchanged.
- The `CI=true` auto-detect default is the operator's "always intuitive in CI environment" framing — developers running locally without flags get the production-shape path; CI runs without flags get the fast path; explicit `pnpm test:ci-e2e` works in either environment for testing the CI path locally.
- "Complete the GitHub CI setup" is scoped to the test workflow only. Lint, security audit (`pnpm audit`), Dependabot configuration, PR templates, status badges, and branch-protection rules are out of scope and will be picked up in a follow-up if needed.

# Tasks — ci-e2e-bringup

## Helpers refactor

- [ ] `apps/integration-tests/src/helpers.ts`:
  - Add `resolveBringup()` — returns `'docker' | 'process' | null` from `INTEGRATION_BRINGUP`, with `INTEGRATION_DOCKER=1` honored as legacy alias for `docker`, and `CI` env truthy as auto-default to `process`. Returning `null` means the e2e suite is skipped.
  - Rename `dockerAvailable()` → `bringupAvailable()`. Resolves the mode; if `docker`, also verifies `docker compose version` + `docker info`. Returns `false` on any error.
  - Rename `composeUp()` → `dockerComposeUp()` (private). Same for `composeDown()` → `dockerComposeDown()`.
  - Add `processUp()` — spawns `apps/coinbase-mock/dist/main.js` + `apps/hub/dist/main.js` as child processes via `node:child_process.spawn` with `process.execPath`. Env per the proposal. Captures last 80 stdio lines per child. Polls `/control/state` (mock) and `/healthz` (hub) until 200, with a 30s overall timeout. Throws a clear error if `dist/main.js` is missing for either.
  - Add `processDown()` — SIGTERM both children; 3s SIGKILL fallback; `await` exit.
  - Add `stackUp()` / `stackDown()` — public dispatchers that pick the underlying impl based on the resolved bringup mode.
- [ ] `apps/integration-tests/src/lifecycle.test.ts`:
  - Replace `composeUp` / `composeDown` / `dockerAvailable` calls with `stackUp` / `stackDown` / `bringupAvailable`.
  - Update the skip-message text to reference `INTEGRATION_BRINGUP` instead of `INTEGRATION_DOCKER`.

## Package scripts

- [ ] `apps/integration-tests/package.json`:
  - `test:e2e` → `INTEGRATION_BRINGUP=docker vitest run`
  - Add `test:ci-e2e` → `INTEGRATION_BRINGUP=process vitest run`
  - `test` stays as `vitest run --passWithNoTests` (no bringup → skip).

## Verification

- [ ] `pnpm -r build && pnpm test:ci-e2e` — verify 4/4 green via process bringup.
- [ ] `pnpm test:e2e` — verify 4/4 green via Docker bringup, no regression.
- [ ] `pnpm -r typecheck` — clean.
- [ ] `pnpm -r test` — unit suite still 122/122 green; integration tests still skipped.

## Docs

- [ ] `apps/integration-tests/README.md` (if present) — note the two bringup modes and which to use when. If no README exists, add a brief one in this milestone.
- [ ] No DEC updates beyond DEC-034 (already created in scaffold).

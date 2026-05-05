# GitHub Actions CI Workflow

**Initiative:** github-ci-e2e
**Milestone:** 2/2

## What

Add `.github/workflows/ci.yml` so every pull request and push to `main` runs the build, typecheck, unit suite, and process-bringup e2e suite (`pnpm test:ci-e2e`, landed in M1). The workflow uses pnpm with caching keyed off `pnpm-lock.yaml`. Concurrency cancels in-progress runs on the same branch when a new commit lands.

## References

- DEC-034 — CI-Friendly E2E via Native Node Processes
- DS-OPERATOR-USABILITY (CI is the bot operator; status checks must be legible)
- DS-BRIEF (production-shaped code: tests, CI)

## Approach

Single workflow file, single job (`test`), Ubuntu runner.

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3   # version from packageManager in package.json
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm -r build
      - run: pnpm -r typecheck
      - run: pnpm -r test
      - run: pnpm --filter @silver8/integration-tests run test:ci-e2e
```

Notes on each step:

- `pnpm/action-setup@v3` reads the pnpm version from `packageManager` in root `package.json` (`pnpm@8.15.0`).
- `actions/setup-node@v4` reads Node version from `.nvmrc` (currently `20`).
- `cache: pnpm` keys the pnpm store cache off `pnpm-lock.yaml`. Cold runs ~30s, cached ~5s.
- `pnpm -r build` is required before `test:ci-e2e` because process bringup spawns `apps/coinbase-mock/dist/main.js` and `apps/hub/dist/main.js`. (Unit tests don't need it but turbo's task graph handles dependency-aware ordering anyway.)
- `pnpm -r test` runs the unit suite across all packages. Integration tests in `apps/integration-tests` skip with the helpful message because no `INTEGRATION_BRINGUP` is set at this point.
- `pnpm --filter @silver8/integration-tests run test:ci-e2e` sets `INTEGRATION_BRINGUP=process` and runs the lifecycle suite. Auto-detection via `CI=true` is also active (GitHub Actions sets it), so even if a future workflow misses the explicit script, the suite runs in process mode rather than failing.

Concurrency rationale: PRs cancel-in-progress (a new push obsoletes the old run). Pushes to `main` do *not* cancel — every commit that lands on `main` should produce a full run for status-check completeness.

`permissions: contents: read` is the least-privilege minimum. No write access needed; the workflow only reads code and reports test results via the standard checks API.

## Tests

- Workflow YAML must be syntactically valid (parse with `yq` or `actionlint` if available).
- Step expansions reference variables that exist (`github.workflow`, `github.ref`, `github.event_name`).
- Step ordering matches local invocation: install → build → typecheck → test → test:ci-e2e.
- Cannot fully test until pushed to GitHub — the artifact lands as `.github/workflows/ci.yml` and ships its first run with this commit.

## Non-goals (per operator: "just test related will do")

- Lint workflow / ESLint configuration.
- Security audit (`pnpm audit`).
- Dependabot / Renovate configuration.
- PR template / issue templates.
- Status badge in README.
- Branch protection rules (operator-side configuration, not in code).
- Codecov / coverage reporting.
- Matrix testing across Node versions.

These are deferrable; current scope is "CI runs the test suite on every PR and main push, with sane caching and concurrency."

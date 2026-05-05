# Tasks — github-actions-workflow

- [ ] Create `.github/workflows/ci.yml` with the workflow described in the proposal.
- [ ] Verify YAML parses (`yq -P .github/workflows/ci.yml > /dev/null` or equivalent).
- [ ] If `actionlint` is installed locally, run it against the workflow file.
- [ ] Update `apps/integration-tests/README.md` to mention the workflow file path (already mentioned generically in M1's README; add the concrete `.github/workflows/ci.yml` reference).
- [ ] First push will trigger the run on PR / main. Operator validates status check appears.

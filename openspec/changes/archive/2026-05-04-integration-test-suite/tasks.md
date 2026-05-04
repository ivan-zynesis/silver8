# Tasks — integration-test-suite

- [ ] `apps/coinbase-mock/Dockerfile` (small, copies workspace + builds + runs the binary)
- [ ] `docker-compose.integration.yml` with hub + coinbase-mock services
- [ ] `apps/integration-tests` package: vitest + helpers
- [ ] Helpers: composeUp, composeDown, waitForReady, wsConnect, recv-with-timeout, injectGap
- [ ] Test 1: subscribe → upstream attach → snapshot
- [ ] Test 2: sequence gap → stale → resync (uses /control/inject-gap)
- [ ] Test 3: disconnect → channel unsub → idle → socket close
- [ ] Test 4: upstream disconnect → automatic reconnect (uses /control/disconnect)
- [ ] Skip behavior when Docker unavailable: tests marked skipped with clear message
- [ ] Documentation note in the proposal about how to run (`pnpm --filter @silver8/integration-tests test`)

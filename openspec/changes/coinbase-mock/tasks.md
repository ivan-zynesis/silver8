# Tasks — coinbase-mock

- [ ] `apps/coinbase-mock` package scaffolding (Node + TS, vitest)
- [ ] Fixture format: JSONL of envelope objects
- [ ] Synthetic baseline fixture: BTC-USD + ETH-USD with snapshot + ~50 updates + heartbeats
- [ ] Recorder script (`scripts/record.ts`) — connects to real Coinbase, dumps to JSONL. Ships but not run in CI.
- [ ] Fixture loader: parses JSONL, validates envelope shape
- [ ] Replay engine: per-connection monotonic sequence rewriting; subscription filter; pacing
- [ ] WS server: accept connections, handle subscribe/unsubscribe/heartbeats ops, drive replay
- [ ] Control plane: HTTP server with /inject-gap, /disconnect, /silence, /slow, /state
- [ ] Env-driven config (MOCK_WS_PORT, MOCK_CONTROL_PORT, MOCK_FIXTURE, MOCK_LOOP, MOCK_RATE_HZ)
- [ ] Unit tests: loader, filter, sequence rewriting
- [ ] Integration-shape test: spawn mock, connect WS client, verify expected envelope flow + gap injection

# Tasks — demand-driven-lifecycle

- [ ] Env: add `INGESTION_LIFECYCLE` (default `demand_driven`) and `INGESTION_SOCKET_IDLE_MS` (default 300000)
- [ ] CoinbaseAdapter: per-channel state tracking; `ensureConnected()`; socket-idle timer
- [ ] CoinbaseAdapter: `subscribeChannels(symbols)` / `unsubscribeChannels(symbols)` methods
- [ ] IngestionService: branch on `LIFECYCLE`. In `demand_driven`, register on Registry.onDemandChange and drive (un)subscribe; do not pre-subscribe.
- [ ] Readiness: in demand_driven, declare ready once the listener is registered
- [ ] Status: surface `lifecycle` + `subscribedChannels` in upstream.coinbase block
- [ ] Tests: adapter channel state and idle timer (vitest fake timers)
- [ ] Tests: ingestion.service responds to demand changes correctly in both lifecycle modes
- [ ] Smoke: boot hub, connect WS client subscribing to BTC-USD; verify upstream `subscribedChannels` includes BTC-USD; close client; verify channel is removed; verify socket close after idle

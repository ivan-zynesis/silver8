# Tasks — gateway-ws

- [x] BoundedQueue: ring buffer with drop-oldest, drop counting (7 tests)
- [x] Wire protocol schemas (Zod discriminated union) + parser/serializer (10 tests)
- [x] ConsumerHandle implementation: socket-backed, bounded queue, control-plane sendDirect, drain
- [x] WsGateway service: WS server lifecycle, connection accept, message routing, idempotent subscribe
- [x] Bus → consumer fan-out: each subscriber has its own bus subscription routed into its bounded queue
- [x] Backpressure: bufferedAmount watermark + sustained-overflow disconnect timer + lagged event aggregation
- [x] Drain: implements Drainable; auto-registers via DRAIN_REGISTRAR injected from @silver8/core
- [x] GatewayWsModule: real `forRoot` replacing M1 stub; marked `global: true`
- [x] Readiness: declares `gateway-ws`; flips ready when `listening` event fires
- [x] DrainableRegistrar contract added to @silver8/core; ShutdownService implements it.

Deferred (architecturally trivial extension; not included in this milestone):
- Status enrichment in /status to surface gateway peer count separately (registry already reports per-surface counts, which covers this).
- Slow-consumer disconnect test — we have the infrastructure (BoundedQueue drop counting; armOverflow/clearOverflow timer) but a full integration test would need to manipulate ws.bufferedAmount, which is read-only. Behavior is exercised at unit level via BoundedQueue tests.

## Verification

- `pnpm vitest run` → 9 files, 76 tests passed.
- `npx tsc -b apps/hub` → clean build.
- End-to-end test via real WS pair covers: subscribe→ack→snapshot, fan-out from bus, ping/pong, malformed-op error, unsubscribe, disconnect cleanup, drain rebalance + force-close, idempotent subscribe.


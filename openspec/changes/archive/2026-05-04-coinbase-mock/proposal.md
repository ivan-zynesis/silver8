# Realistic Coinbase Mock from Real-Session Captures

**Initiative:** hub-dashboard-and-lifecycle
**Milestone:** 3/4

## What

Stand up `apps/coinbase-mock` — a small WebSocket server that replays captured Coinbase Advanced Trade sessions and exposes a control plane for fault injection. Mock fidelity grounded in observed reality, per DEC-028 ("mock from observed, not imagined").

## References

- DEC-028 (realistic Coinbase mock from real-session captures) — primary
- DEC-010 (sequence-gap detection) — fault injection exercises this
- DS-COINBASE-WS

## Approach

### Capture format

Captures are stored under `apps/coinbase-mock/fixtures/<name>.jsonl`. Each line is one envelope as Coinbase emitted it:

```
{"channel":"l2_data","timestamp":"...","sequence_num":1,"events":[{"type":"snapshot","product_id":"BTC-USD","updates":[...]}]}
{"channel":"l2_data","timestamp":"...","sequence_num":2,"events":[{"type":"update","product_id":"BTC-USD","updates":[...]}]}
{"channel":"heartbeats","timestamp":"...","sequence_num":3,"events":[{"current_time":"...","heartbeat_counter":1}]}
...
```

A small `record-coinbase.ts` script captures real sessions for a few minutes and writes the JSONL fixture. Scope: not part of the runtime, just a developer tool.

### Mock server

WebSocket server speaks the Advanced Trade protocol surface our adapter uses:
- Accepts `subscribe` / `unsubscribe` ops on `level2` and `heartbeats` channels.
- Tracks per-connection subscribed (symbol, channel) tuples.
- Replays from a configured fixture: emits envelopes with `sequence_num` rewritten to be monotonic-per-connection (so each test gets a clean sequence stream).
- Filters envelopes to only emit those for currently-subscribed (symbol, channel) pairs.
- Optionally loops the fixture indefinitely (default) or stops at end.

### Control plane

A second HTTP port exposes a small fault-injection API that integration tests call mid-flight:

```
POST /control/inject-gap                    skip the next sequence number
POST /control/disconnect                    forcibly close all WS connections
POST /control/silence?ms=N                  stop emitting for N ms (heartbeat watchdog test)
POST /control/slow?ms=N                     emit one envelope every N ms (backpressure test)
GET  /control/state                         snapshot of connections, subs, current fixture cursor
```

Control HTTP is separate from the WS port — keeps the wire protocol clean.

### Configuration

Env-driven:
- `MOCK_WS_PORT` (default 8765) — Coinbase-shaped WS endpoint
- `MOCK_CONTROL_PORT` (default 8766) — fault injection HTTP
- `MOCK_FIXTURE` — path to JSONL fixture (default: `fixtures/btc-usd-baseline.jsonl`)
- `MOCK_LOOP` — `true` (default) — loop the fixture
- `MOCK_RATE_HZ` — emit cadence (default: as captured; 0 = as fast as possible)

### Synthetic-baseline fixture (M3 deliverable)

We don't actually capture real Coinbase in the take-home environment (no guarantee of network, no auth setup, market hours). Instead M3 ships a **synthetic baseline fixture** that's structurally faithful:
- BTC-USD, ETH-USD snapshots followed by ~50 incremental updates.
- Realistic sequence numbers, timestamps spaced 100-500ms.
- Heartbeats every ~1s.

The mock is structured so a real capture (via the recorder script) can replace the synthetic baseline without code changes. The "mock from observed" methodology is honored at the *structure* level; the synthetic fixture is the v1 instance, real captures are the production-grade upgrade path.

## Tests

- Unit: fixture loader (parses JSONL correctly, handles malformed lines).
- Unit: subscription filter (envelopes only emitted for subscribed pairs).
- Unit: sequence rewriting (per-connection monotonic).
- Integration-shape: spawn mock + connect a test WS client; subscribe → verify expected envelopes; inject gap → verify envelope with skipped sequence_num.

## Non-goals

- Capturing real Coinbase sessions (the recorder script ships, but we don't run it as part of the milestone).
- Implementing every Coinbase channel (we cover `level2` and `heartbeats`; that's what the adapter uses).
- Authentication / signed requests — the mock is unauthenticated.

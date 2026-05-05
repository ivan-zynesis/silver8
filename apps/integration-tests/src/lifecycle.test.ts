import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  composeDown,
  composeUp,
  disconnectMockClients,
  dockerAvailable,
  fetchStatus,
  injectMockGap,
  recvUntil,
  waitFor,
  wsConnect,
} from './helpers.js';

const URI_BTC = 'market://coinbase/book/BTC-USD';
const URI_ETH = 'market://coinbase/book/ETH-USD';

const dockerOk = dockerAvailable();
// In environments without docker (or where the operator opted out), every test
// reports skipped with a clear message. The compose recipe IS the deployment
// shape — running these locally requires `docker compose` v2.
const describeFn = dockerOk ? describe : describe.skip;

describeFn('hub-dashboard-and-lifecycle: end-to-end via docker-compose', () => {
  beforeAll(async () => {
    await composeUp();
    // /readyz waits for ingestion to be capable; healthcheck in compose already
    // gated on /healthz, so this is a quick double-check that the app is alive.
    await waitFor(async () => {
      try {
        const status = await fetchStatus();
        return status.upstream.coinbase ? status : null;
      } catch {
        return null;
      }
    }, 30_000);
    // 5-minute timeout accounts for a cold first run (no Docker layer cache,
    // no warm pnpm store mount). Re-runs fit well under a minute; set
    // SKIP_DOCKER_BUILD=1 once images exist to skip --build entirely.
  }, 300_000);

  afterAll(async () => {
    await composeDown();
  }, 30_000);

  it('test 1 — subscribe → upstream attach → snapshot delivered', async () => {
    // Initial state: demand-driven, no consumers yet.
    const before = await fetchStatus();
    expect(before.upstream.coinbase!.lifecycle).toBe('demand_driven');
    expect(before.upstream.coinbase!.subscribedChannels).toEqual([]);

    const c = await wsConnect();
    c.send({ op: 'subscribe', resource: URI_BTC });

    // Expect: ack, then a snapshot. The snapshot may take a moment as the
    // adapter opens the upstream WS to the mock and propagates the snapshot.
    type Msg = { event: string; resource?: string; data?: unknown };
    const ack = await recvUntil<Msg>(c, (m): m is Msg =>
      typeof m === 'object' && m !== null && (m as Msg).event === 'ack',
    );
    expect(ack.resource).toBe(URI_BTC);

    const snapshot = await recvUntil<Msg & { data: { bids: { price: number }[]; asks: { price: number }[] } }>(
      c,
      (m): m is Msg & { data: { bids: { price: number }[]; asks: { price: number }[] } } =>
        typeof m === 'object' && m !== null && (m as Msg).event === 'snapshot',
    );
    expect(snapshot.resource).toBe(URI_BTC);
    expect(snapshot.data.bids.length).toBeGreaterThan(0);
    expect(snapshot.data.asks.length).toBeGreaterThan(0);

    // /status reflects the upstream attach.
    const during = await fetchStatus();
    expect(during.upstream.coinbase!.subscribedChannels).toContain('BTC-USD');

    c.close();
  }, 30_000);

  it('test 2 — disconnect → channel unsub → idle → socket close', async () => {
    const c = await wsConnect();
    c.send({ op: 'subscribe', resource: URI_BTC });

    // Wait until the subscription registers and at least one update flows.
    type Msg = { event: string; resource?: string };
    await recvUntil<Msg>(c, (m): m is Msg =>
      typeof m === 'object' && m !== null && (m as Msg).event === 'snapshot',
    );

    // Disconnect the WS client; demand should immediately drop.
    c.close();

    // Channel unsub is immediate (DEC-027 channel-level grace = 0).
    await waitFor(async () => {
      const s = await fetchStatus();
      return s.upstream.coinbase!.subscribedChannels.length === 0 ? s : null;
    }, 5_000);

    // Socket close fires after INGESTION_SOCKET_IDLE_MS (2000ms in the
    // compose env). Wait a bit more than that, then assert idle.
    await waitFor(async () => {
      const s = await fetchStatus();
      return s.upstream.coinbase!.status === 'idle' ? s : null;
    }, 7_000);

    const after = await fetchStatus();
    expect(after.upstream.coinbase!.status).toBe('idle');
    expect(after.upstream.coinbase!.subscribedChannels).toEqual([]);
  }, 30_000);

  it('test 3 — sequence gap → topic stale → automatic resync → fresh', async () => {
    const c = await wsConnect();
    c.send({ op: 'subscribe', resource: URI_BTC });

    type Msg = { event: string; resource?: string };
    // Wait for an upstream-driven `update` event before injecting the gap.
    // An `update` proves the protocol handler has processed at least one
    // upstream envelope and established a sequence baseline (lastSeq != null).
    // The initial `snapshot` event can come from the gateway's sticky
    // store-backed snapshot (when prior tests left BTC-USD in the store),
    // which doesn't pass through the protocol handler — so racing the gap
    // injection against that snapshot can let assignSequence consume the
    // pendingGap on the very first upstream emission, and no gap is ever
    // detected because there's no baseline to compare against.
    await recvUntil<Msg>(c, (m): m is Msg => typeof m === 'object' && m !== null && (m as Msg).event === 'update');

    // Inject a sequence gap on the upstream side. The hub's protocol handler
    // (DEC-010) should detect it, mark the topic stale, then resubscribe and
    // resync from a fresh snapshot.
    await injectMockGap();

    // Expect a `stale` event on the gateway.
    const stale = await recvUntil<Msg & { reason?: string }>(
      c,
      (m): m is Msg & { reason?: string } =>
        typeof m === 'object' && m !== null && (m as Msg).event === 'stale',
      80,
    );
    expect(stale.resource).toBe(URI_BTC);

    // Then a fresh snapshot delivers (after resync).
    const freshSnapshot = await recvUntil<Msg>(
      c,
      (m): m is Msg => typeof m === 'object' && m !== null && (m as Msg).event === 'snapshot',
      80,
    );
    expect(freshSnapshot.resource).toBe(URI_BTC);

    c.close();
  }, 30_000);

  it('test 4 — upstream disconnect → automatic reconnect → service resumes', async () => {
    const c = await wsConnect();
    c.send({ op: 'subscribe', resource: URI_ETH });

    type Msg = { event: string; resource?: string };
    await recvUntil<Msg>(c, (m): m is Msg =>
      typeof m === 'object' && m !== null && (m as Msg).event === 'snapshot',
    );

    // Disconnect the upstream side via the mock's control plane.
    await disconnectMockClients();

    // After reconnect, we should see another snapshot (resync).
    const freshSnapshot = await recvUntil<Msg>(
      c,
      (m): m is Msg => typeof m === 'object' && m !== null && (m as Msg).event === 'snapshot',
      120,
    );
    expect(freshSnapshot.resource).toBe(URI_ETH);

    // /status shows the channel still subscribed (consumer never left).
    const after = await fetchStatus();
    expect(after.upstream.coinbase!.subscribedChannels).toContain('ETH-USD');

    c.close();
  }, 60_000);
});

if (!dockerOk) {
  // eslint-disable-next-line no-console
  console.log(
    '[integration-tests] suite skipped (default). To run end-to-end against ' +
      'docker-compose, set INTEGRATION_DOCKER=1 with a working Docker daemon. ' +
      'See apps/integration-tests/README or DEC-029 for what the suite covers.',
  );
}

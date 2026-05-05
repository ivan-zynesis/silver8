import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bringupAvailable,
  disconnectMockClients,
  fetchStatus,
  injectMockGap,
  mcpDelete,
  mcpInitialize,
  mcpOpenSseStream,
  mcpPost,
  recvUntil,
  resolveBringup,
  stackDown,
  stackUp,
  waitFor,
  wsConnect,
} from './helpers.js';

const URI_BTC = 'market://coinbase/book/BTC-USD';
const URI_ETH = 'market://coinbase/book/ETH-USD';

const bringupOk = bringupAvailable();
const bringupMode = resolveBringup() ?? 'none';
// In environments without a usable bringup mode, every test reports skipped
// with a clear message. The Docker compose recipe IS the deployment shape
// (DEC-029); the process bringup (DEC-034) runs the same tests as native Node
// child processes for fast CI feedback.
const describeFn = bringupOk ? describe : describe.skip;

describeFn(`hub-dashboard-and-lifecycle: end-to-end (bringup=${bringupMode})`, () => {
  beforeAll(async () => {
    await stackUp();
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
    await stackDown();
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

  it('test 5 — MCP HTTP: initialize → subscribe → notification arrives', async () => {
    // DEC-035: stateful Streamable HTTP transport. Initialize gets us a
    // session id, GET opens the server-initiated SSE stream, then a
    // resources/subscribe POST registers an MCP consumer. Upstream book
    // updates should produce notifications/resources/updated on the SSE
    // stream — symmetric to the WS gateway's snapshot/update events.
    const { sessionId } = await mcpInitialize();

    // Per MCP spec the client sends an initialized notification after
    // initialize before any further requests.
    const initd = await mcpPost(sessionId, {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });
    initd.body?.cancel().catch(() => undefined);

    // /status should reflect the new MCP consumer (registry-tracked).
    await waitFor(async () => {
      const s = await fetchStatus();
      return s.consumers.mcp >= 1 ? s : null;
    }, 5_000);

    const sse = await mcpOpenSseStream(sessionId);
    try {
      const subRes = await mcpPost(sessionId, {
        jsonrpc: '2.0',
        id: 2,
        method: 'resources/subscribe',
        params: { uri: URI_BTC },
      });
      expect(subRes.status).toBe(200);
      // Drain — the SDK may answer via SSE on the POST response stream OR
      // via a plain JSON body; we don't care about the result, only that
      // the subscription registered. Cancel to release the connection.
      subRes.body?.cancel().catch(() => undefined);

      // Subscription must reflect on /status: BTC-USD now has at least one
      // consumer (the MCP session), and upstream channel attaches.
      await waitFor(async () => {
        const s = await fetchStatus();
        return s.upstream.coinbase!.subscribedChannels.includes('BTC-USD') ? s : null;
      }, 10_000);

      // Wait for a resources/updated notification keyed to BTC-USD.
      const note = await sse.next(
        (m) => {
          const p = m.parsed as
            | { method?: string; params?: { uri?: string } }
            | undefined;
          return (
            !!p &&
            p.method === 'notifications/resources/updated' &&
            p.params?.uri === URI_BTC
          );
        },
        20_000,
      );
      const parsed = note.parsed as { params: { uri: string } };
      expect(parsed.params.uri).toBe(URI_BTC);
    } finally {
      sse.close();
      await mcpDelete(sessionId);
    }
  }, 60_000);
});

if (!bringupOk) {
  // eslint-disable-next-line no-console
  console.log(
    '[integration-tests] suite skipped. To run end-to-end:\n' +
      '  - `pnpm test:e2e`     — Docker-compose bringup (DEC-029); requires Docker.\n' +
      '  - `pnpm test:ci-e2e`  — native Node-process bringup (DEC-034); no Docker needed.\n' +
      'In CI environments (CI=true), the process bringup is auto-selected.\n' +
      'See apps/integration-tests/README, DEC-029, and DEC-034 for what the suite covers.',
  );
}

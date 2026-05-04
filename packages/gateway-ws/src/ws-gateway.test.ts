import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { WebSocket as WsClient } from 'ws';
import {
  type Drainable,
  type DrainableRegistrar,
  type ReadinessReporter,
  type ResourceURI,
  type TopicDescriptor,
  type VenueAdapterCatalog,
} from '@silver8/core';
import {
  InMemoryBus,
  InMemoryOrderBookStore,
  InMemoryRegistry,
} from '@silver8/core-memory';
import { WsGatewayService } from './ws-gateway.service.js';
import { type GatewayWsConfig } from './config.js';

const URI: ResourceURI = 'market://coinbase/book/BTC-USD';

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  trace: () => {},
  child: function () { return this; },
} as never;

class FakeReadiness implements ReadinessReporter {
  declared: string[] = [];
  state = new Map<string, boolean>();
  declare(c: string) { this.declared.push(c); }
  set(c: string, r: boolean) { this.state.set(c, r); }
}

class FakeRegistrar implements DrainableRegistrar {
  drainables: Drainable[] = [];
  register(d: Drainable) { this.drainables.push(d); }
}

function makeCatalog(symbols: string[]): VenueAdapterCatalog {
  const entries: TopicDescriptor[] = symbols.map((symbol) => ({
    uri: `market://coinbase/book/${symbol}` as ResourceURI,
    kind: 'book',
    venue: 'coinbase',
    symbol,
    description: `book for ${symbol}`,
  }));
  const byUri = new Map(entries.map((e) => [e.uri, e]));
  return {
    venue: 'coinbase',
    listCatalog: () => entries,
    describeCatalogEntry: (uri) => byUri.get(uri),
    catalogReady: true,
  };
}

interface Harness {
  bus: InMemoryBus;
  store: InMemoryOrderBookStore;
  registry: InMemoryRegistry;
  service: WsGatewayService;
  port: number;
  registrar: FakeRegistrar;
  readiness: FakeReadiness;
  catalog: VenueAdapterCatalog;
}

let portCounter = 31337;
function nextPort(): number {
  // Avoid colliding tests by always using a fresh port. Range chosen to avoid
  // common reserved ports.
  portCounter += 1;
  return portCounter;
}

async function makeHarness(overrides?: Partial<GatewayWsConfig>): Promise<Harness> {
  const bus = new InMemoryBus();
  const store = new InMemoryOrderBookStore();
  const registry = new InMemoryRegistry();
  const port = nextPort();
  const config: GatewayWsConfig = {
    port,
    queueDepth: 1000,
    overflowDisconnectMs: 5000,
    bufferedWatermarkBytes: 1024 * 1024,
    drainDeadlineMs: 1000,
    ...overrides,
  };
  const readiness = new FakeReadiness();
  const registrar = new FakeRegistrar();
  const catalog = makeCatalog(['BTC-USD', 'ETH-USD', 'SOL-USD']);
  const service = new WsGatewayService(
    config,
    bus,
    registry,
    store,
    noopLogger,
    readiness,
    registrar,
    catalog,
  );
  service.onApplicationBootstrap();
  // Wait until the WS server is actually listening (readiness flips at 'listening').
  await new Promise<void>((resolve, reject) => {
    const startedAt = Date.now();
    const check = () => {
      if (readiness.state.get('gateway-ws') === true) return resolve();
      if (Date.now() - startedAt > 2000) return reject(new Error('gateway never became ready'));
      setTimeout(check, 5);
    };
    check();
  });
  return { bus, store, registry, service, port, registrar, readiness, catalog };
}

async function teardown(h: Harness): Promise<void> {
  await h.service.onModuleDestroy();
}

interface Client {
  ws: WsClient;
  recv(timeoutMs?: number): Promise<unknown>;
  send(obj: unknown): void;
  close(): void;
}

function connect(port: number): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WsClient(`ws://127.0.0.1:${port}`);
    const buffered: unknown[] = [];
    const waiters: Array<{
      resolve: (v: unknown) => void;
      reject: (e: Error) => void;
      timer: NodeJS.Timeout;
    }> = [];

    let opened = false;

    ws.on('message', (data: Buffer) => {
      const msg = JSON.parse(data.toString('utf8'));
      const w = waiters.shift();
      if (w) {
        clearTimeout(w.timer);
        w.resolve(msg);
      } else {
        buffered.push(msg);
      }
    });
    ws.on('error', (err) => {
      while (waiters.length) {
        const w = waiters.shift()!;
        clearTimeout(w.timer);
        w.reject(err);
      }
      if (!opened) reject(err);
    });
    ws.on('open', () => {
      opened = true;
      resolve({
        ws,
        send(obj) { ws.send(JSON.stringify(obj)); },
        close() { ws.close(); },
        recv(timeoutMs = 1500) {
          if (buffered.length > 0) return Promise.resolve(buffered.shift());
          return new Promise<unknown>((res, rej) => {
            const timer = setTimeout(() => {
              rej(new Error(`recv timeout after ${timeoutMs}ms`));
            }, timeoutMs);
            waiters.push({ resolve: res, reject: rej, timer });
          });
        },
      });
    });
  });
}

describe('WsGatewayService — end-to-end via real WS', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await makeHarness();
  });

  afterEach(async () => {
    await teardown(h);
  });

  it('registers itself with the drain registrar and the readiness reporter', () => {
    expect(h.registrar.drainables).toHaveLength(1);
    expect(h.registrar.drainables[0].drainName).toBe('gateway-ws');
    expect(h.readiness.declared).toContain('gateway-ws');
    expect(h.readiness.state.get('gateway-ws')).toBe(true);
  });

  it('handles subscribe → ack + snapshot, then delivers fan-out from the bus', async () => {
    h.store.applySnapshot(URI, {
      venue: 'coinbase',
      symbol: 'BTC-USD',
      sequence: 1,
      timestamp: '2026-05-02T12:00:00.000Z',
      bids: [{ price: 50000, size: 1 }],
      asks: [{ price: 50001, size: 1 }],
    });

    const c = await connect(h.port);
    c.send({ op: 'subscribe', resource: URI, id: 'r1' });

    const ack = (await c.recv()) as { event: string; id?: string };
    expect(ack.event).toBe('ack');
    expect(ack.id).toBe('r1');

    const snap = (await c.recv()) as { event: string; data: { bids: unknown[] } };
    expect(snap.event).toBe('snapshot');
    expect(snap.data.bids).toHaveLength(1);

    await h.bus.publish(URI, {
      kind: 'book.update',
      uri: URI,
      view: {
        venue: 'coinbase',
        symbol: 'BTC-USD',
        bids: [{ price: 50000, size: 0.5 }],
        asks: [{ price: 50001, size: 1 }],
        sequence: 2,
        timestamp: '2026-05-02T12:00:01.000Z',
        stale: false,
      },
    });

    const update = (await c.recv()) as { event: string; sequence: number };
    expect(update.event).toBe('update');
    expect(update.sequence).toBe(2);

    c.close();
  });

  it('rejects malformed subscribe with an error event', async () => {
    const c = await connect(h.port);
    c.send({ op: 'subscribe', resource: 'http://nope' });

    const err = (await c.recv()) as { event: string; code: string };
    expect(err.event).toBe('error');
    expect(err.code).toBe('protocol_error');
    c.close();
  });

  it('rejects subscribe to a well-formed but catalog-unknown URI with enumerated alternatives (DEC-030)', async () => {
    const c = await connect(h.port);
    c.send({ op: 'subscribe', resource: 'market://coinbase/book/UNKNOWN-USD', id: 'r1' });

    const err = (await c.recv()) as {
      event: string; code: string; message: string; id?: string;
    };
    expect(err.event).toBe('error');
    expect(err.code).toBe('unknown_topic');
    expect(err.id).toBe('r1');
    expect(err.message).toMatch(/unknown topic market:\/\/coinbase\/book\/UNKNOWN-USD/);
    expect(err.message).toMatch(/available topics:/);
    expect(err.message).toMatch(/market:\/\/coinbase\/book\/BTC-USD/);

    // The rejection must NOT register a subscription in the registry.
    expect(h.registry.demandFor('market://coinbase/book/UNKNOWN-USD' as ResourceURI)).toBe(0);

    c.close();
  });

  it('responds to ping with pong', async () => {
    const c = await connect(h.port);
    c.send({ op: 'ping', id: 'p1' });
    const pong = (await c.recv()) as { event: string; id?: string };
    expect(pong.event).toBe('pong');
    expect(pong.id).toBe('p1');
    c.close();
  });

  it('unsubscribe stops fan-out delivery and clears refcount', async () => {
    h.store.applySnapshot(URI, {
      venue: 'coinbase',
      symbol: 'BTC-USD',
      sequence: 1,
      timestamp: '2026-05-02T12:00:00.000Z',
      bids: [{ price: 50000, size: 1 }],
      asks: [{ price: 50001, size: 1 }],
    });
    const c = await connect(h.port);
    c.send({ op: 'subscribe', resource: URI });
    await c.recv(); // ack
    await c.recv(); // snapshot

    c.send({ op: 'unsubscribe', resource: URI });
    const ack = (await c.recv()) as { event: string; op: string };
    expect(ack.event).toBe('ack');
    expect(ack.op).toBe('unsubscribe');

    await h.bus.publish(URI, {
      kind: 'book.update',
      uri: URI,
      view: {
        venue: 'coinbase', symbol: 'BTC-USD',
        bids: [], asks: [], sequence: 2, timestamp: 't', stale: false,
      },
    });
    const arrived = await Promise.race([
      c.recv(150).then(() => true).catch(() => false),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 200)),
    ]);
    expect(arrived).toBe(false);
    expect(h.registry.demandFor(URI)).toBe(0);
    c.close();
  });

  it('cleans up registry state on disconnect', async () => {
    const c = await connect(h.port);
    c.send({ op: 'subscribe', resource: URI });
    await c.recv(); // ack (no snapshot — store empty for this test)
    expect(h.registry.demandFor(URI)).toBe(1);

    c.close();
    await new Promise((r) => setTimeout(r, 100));

    expect(h.registry.demandFor(URI)).toBe(0);
    expect(h.registry.status().consumersBySurface.ws).toBe(0);
  });

  it('drain broadcasts rebalance and force-closes after deadline', async () => {
    const c = await connect(h.port);
    c.send({ op: 'subscribe', resource: URI });
    await c.recv(); // ack

    const drainable = h.registrar.drainables[0];
    const drainPromise = drainable.drain(200); // short deadline

    const rebalance = (await c.recv()) as { event: string; reason: string };
    expect(rebalance.event).toBe('rebalance');
    expect(rebalance.reason).toBe('shutdown');

    await drainPromise;
    await new Promise((r) => setTimeout(r, 50));
    expect(c.ws.readyState).toBe(WsClient.CLOSED);
  });

  it('idempotent subscribe — second subscribe to same uri does not double-count', async () => {
    const c = await connect(h.port);
    c.send({ op: 'subscribe', resource: URI });
    await c.recv(); // ack
    expect(h.registry.demandFor(URI)).toBe(1);

    c.send({ op: 'subscribe', resource: URI });
    await c.recv(); // second ack
    expect(h.registry.demandFor(URI)).toBe(1);

    c.close();
  });
});

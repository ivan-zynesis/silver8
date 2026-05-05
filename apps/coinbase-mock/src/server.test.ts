import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket as WsClient } from 'ws';
import { MockServer } from './server.js';
import type { Envelope } from './fixture.js';

const FIXTURE: Envelope[] = [
  {
    channel: 'l2_data', timestamp: 't', sequence_num: 1,
    events: [{ type: 'snapshot', product_id: 'BTC-USD', updates: [] }],
  },
  {
    channel: 'l2_data', timestamp: 't', sequence_num: 2,
    events: [{ type: 'update', product_id: 'BTC-USD', updates: [] }],
  },
  {
    channel: 'l2_data', timestamp: 't', sequence_num: 3,
    events: [{ type: 'update', product_id: 'ETH-USD', updates: [] }],
  },
];

let portCounter = 41000;
function nextPorts(): { ws: number; control: number } {
  portCounter += 2;
  return { ws: portCounter, control: portCounter + 1 };
}

interface Harness {
  server: MockServer;
  wsPort: number;
  controlPort: number;
}

async function makeServer(opts?: { rateHz?: number; loop?: boolean }): Promise<Harness> {
  const { ws, control } = nextPorts();
  const server = new MockServer({
    fixture: FIXTURE,
    wsPort: ws,
    controlPort: control,
    loop: opts?.loop ?? false,
    rateHz: opts?.rateHz ?? 100,
  });
  await server.start();
  return { server, wsPort: ws, controlPort: control };
}

interface Client {
  ws: WsClient;
  recv(timeoutMs?: number): Promise<unknown>;
  send(obj: unknown): void;
  close(): void;
}

function connect(port: number): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WsClient(`ws://127.0.0.1:${port}/`);
    const buffered: unknown[] = [];
    const waiters: Array<{ resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }> = [];
    let opened = false;
    ws.on('message', (data: Buffer) => {
      const msg = JSON.parse(data.toString('utf8'));
      const w = waiters.shift();
      if (w) { clearTimeout(w.timer); w.resolve(msg); } else { buffered.push(msg); }
    });
    ws.on('error', (err) => { if (!opened) reject(err); });
    ws.on('open', () => {
      opened = true;
      resolve({
        ws,
        send: (obj) => ws.send(JSON.stringify(obj)),
        close: () => ws.close(),
        recv: (timeoutMs = 1500) => {
          if (buffered.length) return Promise.resolve(buffered.shift());
          return new Promise((res, rej) => {
            const timer = setTimeout(() => rej(new Error(`recv timeout after ${timeoutMs}ms`)), timeoutMs);
            waiters.push({ resolve: res, reject: rej, timer });
          });
        },
      });
    });
  });
}

async function recvUntil<T>(c: Client, pred: (msg: unknown) => msg is T, max = 30): Promise<T> {
  for (let i = 0; i < max; i++) {
    const m = await c.recv();
    if (pred(m)) return m;
  }
  throw new Error(`recvUntil exhausted after ${max} messages`);
}

describe('MockServer end-to-end', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await makeServer({ loop: true });
  });

  afterEach(async () => {
    await h.server.stop();
  });

  it('emits subscribed events with rewritten sequence numbers', async () => {
    const c = await connect(h.wsPort);
    c.send({ type: 'subscribe', product_ids: ['BTC-USD'], channel: 'level2' });

    // Wait for the subscriptions ack.
    const ack = await recvUntil(c, (m): m is { channel: string } =>
      typeof m === 'object' && m !== null && (m as { channel?: unknown }).channel === 'subscriptions',
    );
    expect(ack).toBeDefined();

    // Pull a few data envelopes and verify they're for BTC-USD only with monotonic seq.
    const seqs: number[] = [];
    for (let i = 0; i < 4; i++) {
      const env = await recvUntil(c, (m): m is { channel: string; sequence_num: number; events: unknown[] } =>
        typeof m === 'object' && m !== null && (m as { channel?: unknown }).channel === 'l2_data',
      );
      seqs.push(env.sequence_num);
      for (const e of env.events) {
        expect((e as { product_id: string }).product_id).toBe('BTC-USD');
      }
    }
    // Strictly monotonic.
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
    }

    c.close();
  });

  it('inject-gap control endpoint causes a sequence skip', async () => {
    const c = await connect(h.wsPort);
    c.send({ type: 'subscribe', product_ids: ['BTC-USD'], channel: 'level2' });

    // discard the subscriptions ack
    await recvUntil(c, (m): m is { channel: string } =>
      typeof m === 'object' && m !== null && (m as { channel?: unknown }).channel === 'subscriptions',
    );

    const first = await recvUntil(c, (m): m is { channel: string; sequence_num: number } =>
      typeof m === 'object' && m !== null && (m as { channel?: unknown }).channel === 'l2_data',
    );

    // Inject the gap.
    const res = await fetch(`http://127.0.0.1:${h.controlPort}/control/inject-gap`, { method: 'POST' });
    expect(res.ok).toBe(true);

    // Race-tolerant assertion: the mock emits at MOCK_RATE_HZ; between the
    // moment we receive `first` and the inject-gap POST taking effect, the
    // mock may have already emitted (or buffered) one or more consecutive
    // envelopes. The pendingGap flag is consumed on the very next emission
    // *after* it's set. Rather than asserting the +2 skip lands precisely
    // on the next envelope received, scan the post-inject stream for ANY
    // consecutive pair with a +2 jump while the rest stay strictly +1.
    let prev = first.sequence_num;
    let gapFound = false;
    for (let i = 0; i < 30; i++) {
      const env = await recvUntil(c, (m): m is { channel: string; sequence_num: number } =>
        typeof m === 'object' && m !== null && (m as { channel?: unknown }).channel === 'l2_data',
      );
      const diff = env.sequence_num - prev;
      if (diff === 2) {
        gapFound = true;
        break;
      }
      expect(diff).toBe(1);
      prev = env.sequence_num;
    }
    expect(gapFound).toBe(true);

    c.close();
  });

  it('GET /control/state reports active connections and subscriptions', async () => {
    const c = await connect(h.wsPort);
    c.send({ type: 'subscribe', product_ids: ['BTC-USD', 'ETH-USD'], channel: 'level2' });
    await recvUntil(c, (m): m is { channel: string } =>
      typeof m === 'object' && m !== null && (m as { channel?: unknown }).channel === 'subscriptions',
    );

    const res = await fetch(`http://127.0.0.1:${h.controlPort}/control/state`);
    const body = (await res.json()) as { connections: Array<{ subscriptions: string[] }> };
    expect(body.connections).toHaveLength(1);
    expect(body.connections[0].subscriptions).toEqual(['level2:BTC-USD', 'level2:ETH-USD']);

    c.close();
  });

  it('disconnect control endpoint closes the WS', async () => {
    const c = await connect(h.wsPort);
    const closed = new Promise<void>((resolve) => c.ws.once('close', () => resolve()));
    await fetch(`http://127.0.0.1:${h.controlPort}/control/disconnect`, { method: 'POST' });
    await closed;
    expect(c.ws.readyState).toBe(WsClient.CLOSED);
  });
});

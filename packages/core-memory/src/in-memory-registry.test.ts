import { describe, expect, it } from 'vitest';
import { InMemoryRegistry } from './in-memory-registry.js';
import type {
  BusMessage,
  ConsumerEvent,
  ConsumerHandle,
  ResourceURI,
  SendResult,
} from '@silver8/core';

const URI_BTC: ResourceURI = 'market://coinbase/book/BTC-USD';
const URI_ETH: ResourceURI = 'market://coinbase/book/ETH-USD';

interface FakeConsumer extends ConsumerHandle {
  delivered: BusMessage[];
  events: ConsumerEvent[];
  disconnects: string[];
}

function makeConsumer(id: string, surface: 'ws' | 'mcp' = 'ws'): FakeConsumer {
  const delivered: BusMessage[] = [];
  const events: ConsumerEvent[] = [];
  const disconnects: string[] = [];
  return {
    id,
    surface,
    connectedAt: new Date().toISOString(),
    delivered,
    events,
    disconnects,
    deliver: (msg): SendResult => {
      delivered.push(msg);
      return { status: 'queued' };
    },
    sendEvent: (e) => events.push(e),
    disconnect: (reason) => disconnects.push(reason),
  } as FakeConsumer;
}

describe('InMemoryRegistry — refcount and lifecycle', () => {
  it('registerConsumer + subscribe drives demand from 0 to 1', () => {
    const reg = new InMemoryRegistry();
    const changes: Array<[string, number, number]> = [];
    reg.onDemandChange((c) => changes.push([c.topic, c.count, c.delta]));

    const c = makeConsumer('c1');
    reg.registerConsumer(c);
    reg.subscribe('c1', URI_BTC);

    expect(reg.demandFor(URI_BTC)).toBe(1);
    expect(changes).toEqual([[URI_BTC, 1, 1]]);
  });

  it('multiple consumers on same topic count once for demand', () => {
    const reg = new InMemoryRegistry();
    const changes: Array<[string, number, number]> = [];
    reg.onDemandChange((c) => changes.push([c.topic, c.count, c.delta]));

    reg.registerConsumer(makeConsumer('a'));
    reg.registerConsumer(makeConsumer('b'));
    reg.subscribe('a', URI_BTC);
    reg.subscribe('b', URI_BTC);

    expect(reg.demandFor(URI_BTC)).toBe(2);
    expect(changes.filter(([, , d]) => d === 1)).toHaveLength(1); // only the first triggered demand
  });

  it('unsubscribe of last consumer drops demand to 0', () => {
    const reg = new InMemoryRegistry();
    const changes: Array<[string, number, number]> = [];
    reg.onDemandChange((c) => changes.push([c.topic, c.count, c.delta]));

    reg.registerConsumer(makeConsumer('a'));
    reg.registerConsumer(makeConsumer('b'));
    reg.subscribe('a', URI_BTC);
    reg.subscribe('b', URI_BTC);

    reg.unsubscribe('a', URI_BTC);
    expect(reg.demandFor(URI_BTC)).toBe(1);
    expect(changes.filter(([, , d]) => d === -1)).toHaveLength(0);

    reg.unsubscribe('b', URI_BTC);
    expect(reg.demandFor(URI_BTC)).toBe(0);
    expect(changes.filter(([, , d]) => d === -1)).toHaveLength(1);
  });

  it('removeConsumer cleans up all subscriptions in one shot', () => {
    const reg = new InMemoryRegistry();
    reg.registerConsumer(makeConsumer('a'));
    reg.subscribe('a', URI_BTC);
    reg.subscribe('a', URI_ETH);

    expect(reg.subscriptionsFor('a')).toHaveLength(2);
    reg.removeConsumer('a');

    expect(reg.subscriptionsFor('a')).toHaveLength(0);
    expect(reg.demandFor(URI_BTC)).toBe(0);
    expect(reg.demandFor(URI_ETH)).toBe(0);
    expect(reg.consumersFor(URI_BTC)).toHaveLength(0);
  });

  it('removeConsumer is idempotent', () => {
    const reg = new InMemoryRegistry();
    reg.registerConsumer(makeConsumer('a'));
    reg.removeConsumer('a');
    expect(() => reg.removeConsumer('a')).not.toThrow();
  });

  it('subscribe is idempotent and does not double-count', () => {
    const reg = new InMemoryRegistry();
    reg.registerConsumer(makeConsumer('a'));
    reg.subscribe('a', URI_BTC);
    reg.subscribe('a', URI_BTC);
    expect(reg.demandFor(URI_BTC)).toBe(1);
    expect(reg.subscriptionsFor('a')).toEqual([URI_BTC]);
  });

  it('subscribe to unknown consumer throws (programming error)', () => {
    const reg = new InMemoryRegistry();
    expect(() => reg.subscribe('ghost', URI_BTC)).toThrow(/unknown consumer/);
  });

  it('register-twice throws (programming error)', () => {
    const reg = new InMemoryRegistry();
    reg.registerConsumer(makeConsumer('a'));
    expect(() => reg.registerConsumer(makeConsumer('a'))).toThrow(/already registered/);
  });

  describe('memory invariants (DEC-006)', () => {
    it('churn — 10k connect/disconnect cycles leave no orphan entries', () => {
      const reg = new InMemoryRegistry();
      for (let i = 0; i < 10_000; i++) {
        const id = `c${i}`;
        reg.registerConsumer(makeConsumer(id));
        reg.subscribe(id, URI_BTC);
        reg.subscribe(id, URI_ETH);
        reg.removeConsumer(id);
      }
      expect(reg.demandFor(URI_BTC)).toBe(0);
      expect(reg.demandFor(URI_ETH)).toBe(0);
      expect(reg.activeTopics()).toEqual([]);
      expect(reg.status().consumersBySurface.ws).toBe(0);
      expect(reg.status().totalSubscriptions).toBe(0);
    });

    it('subscribe/unsubscribe storm — bidirectional indices stay consistent', () => {
      const reg = new InMemoryRegistry();
      for (let i = 0; i < 50; i++) {
        reg.registerConsumer(makeConsumer(`c${i}`));
      }
      // 50 consumers × 2 topics × 200 random subscribe/unsubscribe ops
      for (let n = 0; n < 5_000; n++) {
        const cid = `c${n % 50}`;
        const uri = n % 2 === 0 ? URI_BTC : URI_ETH;
        if (n % 3 === 0) reg.unsubscribe(cid, uri);
        else reg.subscribe(cid, uri);
      }
      // Cross-check: every consumer's recorded subs match every topic's recorded consumers.
      for (let i = 0; i < 50; i++) {
        const cid = `c${i}`;
        for (const uri of reg.subscriptionsFor(cid)) {
          expect(reg.consumersFor(uri).map((c) => c.id)).toContain(cid);
        }
      }
      for (const uri of reg.activeTopics()) {
        for (const c of reg.consumersFor(uri)) {
          expect(reg.subscriptionsFor(c.id)).toContain(uri);
        }
      }
    });
  });

  it('status reports per-surface counts and per-topic consumer counts', () => {
    const reg = new InMemoryRegistry();
    reg.registerConsumer(makeConsumer('w1', 'ws'));
    reg.registerConsumer(makeConsumer('w2', 'ws'));
    reg.registerConsumer(makeConsumer('m1', 'mcp'));
    reg.subscribe('w1', URI_BTC);
    reg.subscribe('w2', URI_BTC);
    reg.subscribe('m1', URI_ETH);

    const s = reg.status();
    expect(s.consumersBySurface).toEqual({ ws: 2, mcp: 1 });
    expect(s.totalSubscriptions).toBe(3);
    expect(s.byTopic).toEqual([
      { topic: URI_BTC, consumerCount: 2 },
      { topic: URI_ETH, consumerCount: 1 },
    ]);
  });
});

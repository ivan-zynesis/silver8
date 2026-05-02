import { describe, expect, it, vi } from 'vitest';
import { InMemoryBus } from './in-memory-bus.js';
import type { BusMessage, ResourceURI } from '@silver8/core';

const TOPIC: ResourceURI = 'market://coinbase/book/BTC-USD';
const TOPIC2: ResourceURI = 'market://coinbase/book/ETH-USD';

function staleMsg(uri: ResourceURI, reason = 'test'): BusMessage {
  return { kind: 'book.stale', uri, reason };
}

describe('InMemoryBus — distributed semantics (DEC-005)', () => {
  it('publish() is async — subscribers fire on microtask, not inline', async () => {
    const bus = new InMemoryBus();
    const calls: string[] = [];
    bus.subscribe(TOPIC, () => calls.push('subscriber'));

    calls.push('before-publish');
    const p = bus.publish(TOPIC, staleMsg(TOPIC));
    calls.push('after-publish-call');
    await p;
    calls.push('after-await');

    // Subscriber MUST run after publish() returns control, never inline.
    expect(calls).toEqual([
      'before-publish',
      'after-publish-call',
      'subscriber',
      'after-await',
    ]);
  });

  it('publish() to a topic with no subscribers is a no-op (lossy)', async () => {
    const bus = new InMemoryBus();
    await expect(bus.publish(TOPIC, staleMsg(TOPIC))).resolves.toBeUndefined();
  });

  it('a subscriber registering AFTER a publish does NOT receive the prior message', async () => {
    const bus = new InMemoryBus();
    await bus.publish(TOPIC, staleMsg(TOPIC, 'first'));

    const handler = vi.fn();
    bus.subscribe(TOPIC, handler);
    await Promise.resolve();
    expect(handler).not.toHaveBeenCalled();
  });

  it('subscriber errors do NOT propagate to publisher', async () => {
    const bus = new InMemoryBus();
    bus.subscribe(TOPIC, () => {
      throw new Error('subscriber blew up');
    });

    await expect(bus.publish(TOPIC, staleMsg(TOPIC))).resolves.toBeUndefined();
  });

  it('one subscriber throwing does NOT stop other subscribers', async () => {
    const bus = new InMemoryBus();
    const ok = vi.fn();
    bus.subscribe(TOPIC, () => {
      throw new Error('first throws');
    });
    bus.subscribe(TOPIC, ok);

    await bus.publish(TOPIC, staleMsg(TOPIC));
    expect(ok).toHaveBeenCalledOnce();
  });

  it('within a topic, delivery is FIFO', async () => {
    const bus = new InMemoryBus();
    const seen: string[] = [];
    bus.subscribe(TOPIC, (m) => {
      if (m.kind === 'book.stale') seen.push(m.reason);
    });

    await bus.publish(TOPIC, staleMsg(TOPIC, 'a'));
    await bus.publish(TOPIC, staleMsg(TOPIC, 'b'));
    await bus.publish(TOPIC, staleMsg(TOPIC, 'c'));
    await Promise.resolve();
    expect(seen).toEqual(['a', 'b', 'c']);
  });

  it('unsubscribe stops delivery; idempotent', async () => {
    const bus = new InMemoryBus();
    const handler = vi.fn();
    const off = bus.subscribe(TOPIC, handler);

    await bus.publish(TOPIC, staleMsg(TOPIC));
    expect(handler).toHaveBeenCalledTimes(1);

    off();
    off(); // idempotent

    await bus.publish(TOPIC, staleMsg(TOPIC));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('emits demand-change on first subscribe and last unsubscribe', () => {
    const bus = new InMemoryBus();
    const changes: Array<{ topic: string; count: number; delta: 1 | -1 }> = [];
    bus.onDemandChange((c) => changes.push({ topic: c.topic, count: c.count, delta: c.delta }));

    const off1 = bus.subscribe(TOPIC, () => {});
    const off2 = bus.subscribe(TOPIC, () => {});
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ topic: TOPIC, count: 1, delta: 1 });

    off1();
    expect(changes).toHaveLength(1); // still has off2; no demand change

    off2();
    expect(changes).toHaveLength(2);
    expect(changes[1]).toMatchObject({ topic: TOPIC, count: 0, delta: -1 });
  });

  it('demand-change fires per topic independently', () => {
    const bus = new InMemoryBus();
    const changes: string[] = [];
    bus.onDemandChange((c) => changes.push(`${c.topic}:${c.delta}`));

    bus.subscribe(TOPIC, () => {});
    bus.subscribe(TOPIC2, () => {});
    expect(changes).toContain(`${TOPIC}:1`);
    expect(changes).toContain(`${TOPIC2}:1`);
  });

  it('activeTopics and demandFor reflect current subscriber state', () => {
    const bus = new InMemoryBus();
    expect(bus.activeTopics()).toEqual([]);
    expect(bus.demandFor(TOPIC)).toBe(0);

    const off = bus.subscribe(TOPIC, () => {});
    expect(bus.activeTopics()).toContain(TOPIC);
    expect(bus.demandFor(TOPIC)).toBe(1);

    off();
    expect(bus.demandFor(TOPIC)).toBe(0);
  });

  it('mid-dispatch unsubscribe of OTHER handler does not skip the original', async () => {
    // Snapshot semantics: handler set captured at publish time, unsubscribes
    // during dispatch don't cause the still-present handler to be skipped.
    const bus = new InMemoryBus();
    let aRan = 0;
    let bRan = 0;
    let offB: (() => void) | undefined;

    bus.subscribe(TOPIC, () => {
      aRan += 1;
      offB?.();
    });
    offB = bus.subscribe(TOPIC, () => {
      bRan += 1;
    });

    await bus.publish(TOPIC, staleMsg(TOPIC));
    expect(aRan).toBe(1);
    expect(bRan).toBe(1); // B still received because snapshot was taken pre-dispatch
  });
});

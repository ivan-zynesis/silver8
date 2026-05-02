import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  InMemoryBus,
  InMemoryOrderBookStore,
} from '@silver8/core-memory';
import type { BusMessage, ResourceURI } from '@silver8/core';
import { BookMaintainer } from '../book/book-maintainer.js';
import { CoinbaseProtocolHandler, type SequenceGap } from './coinbase.protocol-handler.js';

const URI: ResourceURI = 'market://coinbase/book/BTC-USD';

function makeHandler() {
  const bus = new InMemoryBus();
  const store = new InMemoryOrderBookStore();
  const logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    fatal: () => {},
    trace: () => {},
    child: () => logger,
  } as unknown as ConstructorParameters<typeof BookMaintainer>[2];
  // Construct directly (no DI) — just inject the dependencies positionally.
  // BookMaintainer's constructor expects (bus, store, logger) tokens, but at
  // runtime they're plain values. NestJS @Inject only matters at composition.
  const maintainer = new BookMaintainer(bus, store, logger as never);
  const handler = new CoinbaseProtocolHandler(maintainer, logger as never);
  handler.setSubscribedTopics([URI]);
  return { bus, store, maintainer, handler };
}

describe('CoinbaseProtocolHandler', () => {
  it('applies a snapshot and publishes book.snapshot on the bus', async () => {
    const { bus, store, handler } = makeHandler();
    const received: BusMessage[] = [];
    bus.subscribe(URI, (m: BusMessage) => received.push(m));

    await handler.handle({
      channel: 'l2_data',
      timestamp: '2026-05-02T12:00:00.000Z',
      sequence_num: 1,
      events: [
        {
          type: 'snapshot',
          product_id: 'BTC-USD',
          updates: [
            { side: 'bid', event_time: 't', price_level: '50000', new_quantity: '1' },
            { side: 'offer', event_time: 't', price_level: '50001', new_quantity: '1' },
          ],
        },
      ],
    });
    await Promise.resolve(); // microtask drain

    expect(store.has(URI)).toBe(true);
    expect(store.getTopOfBook(URI)?.bidPrice).toBe(50000);
    expect(received).toHaveLength(1);
    expect(received[0].kind).toBe('book.snapshot');
  });

  it('applies an update after a snapshot and publishes book.update', async () => {
    const { bus, store, handler } = makeHandler();
    const received: BusMessage[] = [];
    bus.subscribe(URI, (m: BusMessage) => received.push(m));

    await handler.handle({
      channel: 'l2_data', timestamp: 't', sequence_num: 1,
      events: [{ type: 'snapshot', product_id: 'BTC-USD', updates: [
        { side: 'bid', event_time: 't', price_level: '50000', new_quantity: '1' },
      ]}],
    });
    await handler.handle({
      channel: 'l2_data', timestamp: 't', sequence_num: 2,
      events: [{ type: 'update', product_id: 'BTC-USD', updates: [
        { side: 'bid', event_time: 't', price_level: '50000.5', new_quantity: '0.7' },
      ]}],
    });
    await Promise.resolve();

    expect(store.getTopOfBook(URI)?.bidPrice).toBe(50000.5);
    expect(received.map((m) => m.kind)).toEqual(['book.snapshot', 'book.update']);
  });

  it('skips updates that arrive before snapshot (drop-and-wait)', async () => {
    const { bus, store, handler } = makeHandler();
    const received: BusMessage[] = [];
    bus.subscribe(URI, (m: BusMessage) => received.push(m));

    await handler.handle({
      channel: 'l2_data', timestamp: 't', sequence_num: 1,
      events: [{ type: 'update', product_id: 'BTC-USD', updates: [
        { side: 'bid', event_time: 't', price_level: '50000', new_quantity: '1' },
      ]}],
    });
    await Promise.resolve();
    expect(store.has(URI)).toBe(false);
    expect(received).toEqual([]);
  });

  it('detects sequence gaps and notifies adapter; marks topics stale', async () => {
    const { bus, store, handler } = makeHandler();
    const received: BusMessage[] = [];
    bus.subscribe(URI, (m: BusMessage) => received.push(m));

    const gaps: SequenceGap[] = [];
    handler.setEvents({
      onSequenceGap: (g) => { gaps.push(g); },
      onMessage: () => {},
    });

    await handler.handle({
      channel: 'l2_data', timestamp: 't', sequence_num: 10,
      events: [{ type: 'snapshot', product_id: 'BTC-USD', updates: [
        { side: 'bid', event_time: 't', price_level: '50000', new_quantity: '1' },
      ]}],
    });
    await handler.handle({
      channel: 'l2_data', timestamp: 't', sequence_num: 11,
      events: [{ type: 'update', product_id: 'BTC-USD', updates: [] }],
    });
    // Gap: skipped seq 12.
    await handler.handle({
      channel: 'l2_data', timestamp: 't', sequence_num: 13,
      events: [{ type: 'update', product_id: 'BTC-USD', updates: [
        { side: 'bid', event_time: 't', price_level: '50000', new_quantity: '0.5' },
      ]}],
    });
    await Promise.resolve();
    await Promise.resolve(); // bus dispatch is microtask-queued; drain twice for nested awaits

    expect(gaps).toHaveLength(1);
    expect(gaps[0].expectedSeq).toBe(12);
    expect(gaps[0].receivedSeq).toBe(13);
    expect(gaps[0].affectedTopics).toContain(URI);

    // Stale signal observed on the bus.
    expect(received.find((m) => m.kind === 'book.stale')).toBeDefined();
    // The post-gap update is dropped (not applied) until adapter resync delivers a fresh snapshot.
    expect(store.isStale(URI)).toBe(true);
  });

  it('a fresh snapshot after stale clears the stale flag and emits book.fresh', async () => {
    const { bus, store, handler } = makeHandler();
    const received: BusMessage[] = [];
    bus.subscribe(URI, (m: BusMessage) => received.push(m));

    handler.setEvents({ onSequenceGap: () => {}, onMessage: () => {} });

    await handler.handle({
      channel: 'l2_data', timestamp: 't', sequence_num: 1,
      events: [{ type: 'snapshot', product_id: 'BTC-USD', updates: [
        { side: 'bid', event_time: 't', price_level: '50000', new_quantity: '1' },
      ]}],
    });

    // Force stale (e.g. simulated heartbeat timeout)
    const { maintainer } = makeHandler();
    // Use the actual handler's maintainer instead — re-extract since we don't expose it.
    // Workaround: feed a sequence gap.
    await handler.handle({
      channel: 'l2_data', timestamp: 't', sequence_num: 99,
      events: [{ type: 'update', product_id: 'BTC-USD', updates: [] }],
    });
    await Promise.resolve();
    expect(store.isStale(URI)).toBe(true);

    // Adapter would resubscribe + reset sequence; simulate that.
    handler.resetSequence();
    await handler.handle({
      channel: 'l2_data', timestamp: 't', sequence_num: 200,
      events: [{ type: 'snapshot', product_id: 'BTC-USD', updates: [
        { side: 'bid', event_time: 't', price_level: '50100', new_quantity: '1' },
      ]}],
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(store.isStale(URI)).toBe(false);
    expect(store.getTopOfBook(URI)?.bidPrice).toBe(50100);
    expect(received.find((m) => m.kind === 'book.fresh')).toBeDefined();

    // Use the unused 'maintainer' to satisfy noUnusedLocals in strict configs without warnings.
    void maintainer;
  });

  it('onMessage callback fires for every envelope (watchdog-pet signal)', async () => {
    const { handler } = makeHandler();
    const onMessage = vi.fn();
    handler.setEvents({ onSequenceGap: () => {}, onMessage });

    await handler.handle({
      channel: 'heartbeats', timestamp: 't', sequence_num: 1,
      events: [{ current_time: 't', heartbeat_counter: 1 }],
    });
    await handler.handle({
      channel: 'heartbeats', timestamp: 't', sequence_num: 2,
      events: [{ current_time: 't', heartbeat_counter: 2 }],
    });

    expect(onMessage).toHaveBeenCalledTimes(2);
  });
});

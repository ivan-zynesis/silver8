import { describe, expect, it } from 'vitest';
import {
  InMemoryOrderBookStore,
  InMemoryRegistry,
} from '@silver8/core-memory';
import type { ConsumerHandle, ResourceURI } from '@silver8/core';
import { buildMcpStatus } from './status-builder.js';

const URI: ResourceURI = 'market://coinbase/book/BTC-USD';

function makeConsumer(id: string, surface: 'ws' | 'mcp'): ConsumerHandle {
  return {
    id,
    surface,
    connectedAt: new Date().toISOString(),
    deliver: () => ({ status: 'queued' as const }),
    sendEvent: () => {},
    disconnect: () => {},
  };
}

describe('buildMcpStatus (DEC-022 parity)', () => {
  it('reports per-surface consumer counts and per-topic state', () => {
    const reg = new InMemoryRegistry();
    const store = new InMemoryOrderBookStore();

    reg.registerConsumer(makeConsumer('w1', 'ws'));
    reg.registerConsumer(makeConsumer('m1', 'mcp'));
    reg.subscribe('w1', URI);
    reg.subscribe('m1', URI);

    store.applySnapshot(URI, {
      venue: 'coinbase', symbol: 'BTC-USD',
      sequence: 5, timestamp: '2026-05-02T12:00:00.000Z',
      bids: [{ price: 50000, size: 1 }],
      asks: [{ price: 50001, size: 1 }],
    });

    const status = buildMcpStatus(reg, store, {
      service: 'silver8-market-data-hub',
      mode: 'monolith',
      startedAtMs: Date.now() - 5000,
    });

    expect(status.service).toBe('silver8-market-data-hub');
    expect(status.consumers).toEqual({ ws: 1, mcp: 1, totalSubscriptions: 2 });
    expect(status.topics).toHaveLength(1);
    expect(status.topics[0]).toMatchObject({
      uri: URI,
      consumerCount: 2,
      stale: false,
      sequence: 5,
    });
    expect(status.uptimeSeconds).toBeGreaterThanOrEqual(4);
  });

  it('surfaces topics that have store state but no consumers', () => {
    const reg = new InMemoryRegistry();
    const store = new InMemoryOrderBookStore();
    store.applySnapshot(URI, {
      venue: 'coinbase', symbol: 'BTC-USD',
      sequence: 1, timestamp: 't', bids: [], asks: [],
    });

    const status = buildMcpStatus(reg, store, {
      service: 's', mode: 'monolith', startedAtMs: Date.now(),
    });
    expect(status.topics.map((t) => t.uri)).toContain(URI);
    expect(status.topics[0].consumerCount).toBe(0);
  });

  it('marks topics as stale when the store is stale', () => {
    const reg = new InMemoryRegistry();
    const store = new InMemoryOrderBookStore();
    store.applySnapshot(URI, {
      venue: 'coinbase', symbol: 'BTC-USD',
      sequence: 1, timestamp: 't', bids: [], asks: [],
    });
    store.markStale(URI, 'sequence_gap');

    const status = buildMcpStatus(reg, store, {
      service: 's', mode: 'monolith', startedAtMs: Date.now(),
    });
    expect(status.topics[0].stale).toBe(true);
  });
});

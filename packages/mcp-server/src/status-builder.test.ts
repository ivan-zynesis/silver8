import { describe, expect, it } from 'vitest';
import {
  InMemoryOrderBookStore,
  InMemoryRegistry,
} from '@silver8/core-memory';
import type {
  ConsumerHandle,
  ResourceURI,
  TopicDescriptor,
  VenueAdapterCatalog,
} from '@silver8/core';
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

describe('buildMcpStatus (DEC-022, DEC-032 parity)', () => {
  it('reports catalog independent of active state, plus per-surface consumer counts', () => {
    const reg = new InMemoryRegistry();
    const store = new InMemoryOrderBookStore();
    const catalog = makeCatalog(['BTC-USD', 'ETH-USD', 'SOL-USD']);

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

    const status = buildMcpStatus(reg, store, catalog, {
      service: 'silver8-market-data-hub',
      mode: 'monolith',
      startedAtMs: Date.now() - 5000,
    });

    expect(status.service).toBe('silver8-market-data-hub');
    expect(status.consumers).toEqual({ ws: 1, mcp: 1, totalSubscriptions: 2 });

    // Catalog has all configured symbols regardless of subscription state.
    expect(status.catalog).toHaveLength(3);
    expect(status.catalog.map((c) => c.symbol)).toEqual(['BTC-USD', 'ETH-USD', 'SOL-USD']);
    expect(status.catalog[0]).toMatchObject({ uri: URI, kind: 'book', venue: 'coinbase' });

    // Active reflects subscription/store state.
    expect(status.active).toHaveLength(1);
    expect(status.active[0]).toMatchObject({
      uri: URI,
      consumerCount: 2,
      stale: false,
      sequence: 5,
    });
    expect(status.uptimeSeconds).toBeGreaterThanOrEqual(4);
  });

  it('exposes a populated catalog even when active is empty (cold-start)', () => {
    const reg = new InMemoryRegistry();
    const store = new InMemoryOrderBookStore();
    const catalog = makeCatalog(['BTC-USD', 'ETH-USD']);

    const status = buildMcpStatus(reg, store, catalog, {
      service: 's', mode: 'monolith', startedAtMs: Date.now(),
    });

    expect(status.catalog).toHaveLength(2);
    expect(status.active).toHaveLength(0);
  });

  it('surfaces active topics that have store state but no consumers', () => {
    const reg = new InMemoryRegistry();
    const store = new InMemoryOrderBookStore();
    const catalog = makeCatalog(['BTC-USD']);
    store.applySnapshot(URI, {
      venue: 'coinbase', symbol: 'BTC-USD',
      sequence: 1, timestamp: 't', bids: [], asks: [],
    });

    const status = buildMcpStatus(reg, store, catalog, {
      service: 's', mode: 'monolith', startedAtMs: Date.now(),
    });
    expect(status.active.map((t) => t.uri)).toContain(URI);
    expect(status.active[0].consumerCount).toBe(0);
  });

  it('marks active topics as stale when the store is stale', () => {
    const reg = new InMemoryRegistry();
    const store = new InMemoryOrderBookStore();
    const catalog = makeCatalog(['BTC-USD']);
    store.applySnapshot(URI, {
      venue: 'coinbase', symbol: 'BTC-USD',
      sequence: 1, timestamp: 't', bids: [], asks: [],
    });
    store.markStale(URI, 'sequence_gap');

    const status = buildMcpStatus(reg, store, catalog, {
      service: 's', mode: 'monolith', startedAtMs: Date.now(),
    });
    expect(status.active[0].stale).toBe(true);
  });
});

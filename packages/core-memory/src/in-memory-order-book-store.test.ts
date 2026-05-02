import { describe, expect, it } from 'vitest';
import { InMemoryOrderBookStore } from './in-memory-order-book-store.js';
import type { ResourceURI } from '@silver8/core';

const URI: ResourceURI = 'market://coinbase/book/BTC-USD';

const baseSnap = {
  venue: 'coinbase' as const,
  symbol: 'BTC-USD',
  sequence: 100,
  timestamp: '2026-05-02T12:00:00.000Z',
  bids: [
    { price: 50000, size: 1.0 },
    { price: 49999, size: 2.0 },
    { price: 49998, size: 3.0 },
  ],
  asks: [
    { price: 50001, size: 0.5 },
    { price: 50002, size: 1.5 },
    { price: 50003, size: 2.5 },
  ],
};

describe('InMemoryOrderBookStore', () => {
  it('applies a snapshot and exposes top of book', () => {
    const store = new InMemoryOrderBookStore();
    store.applySnapshot(URI, baseSnap);

    const tob = store.getTopOfBook(URI);
    expect(tob).toBeDefined();
    expect(tob!.bidPrice).toBe(50000);
    expect(tob!.askPrice).toBe(50001);
    expect(tob!.mid).toBe(50000.5);
    expect(tob!.spread).toBe(1);
    expect(tob!.stale).toBe(false);
  });

  it('returns top-N levels sorted (bids desc, asks asc)', () => {
    const store = new InMemoryOrderBookStore();
    store.applySnapshot(URI, baseSnap);

    const view = store.getView(URI, 2);
    expect(view!.bids.map((l) => l.price)).toEqual([50000, 49999]);
    expect(view!.asks.map((l) => l.price)).toEqual([50001, 50002]);
  });

  it('applyUpdate adds, modifies, and removes levels', () => {
    const store = new InMemoryOrderBookStore();
    store.applySnapshot(URI, baseSnap);

    store.applyUpdate(URI, {
      venue: 'coinbase',
      symbol: 'BTC-USD',
      sequence: 101,
      timestamp: '2026-05-02T12:00:01.000Z',
      changes: [
        { side: 'buy', price: 50000, size: 0 }, // remove top bid
        { side: 'buy', price: 50001, size: 0.7 }, // ... but also add new top bid HIGHER than ask?
        // (We intentionally don't enforce crossed-book here; venues do at their layer.)
        { side: 'sell', price: 50002, size: 0 }, // remove second ask
      ],
    });

    const view = store.getView(URI, 5);
    expect(view!.bids.map((l) => l.price).sort((a, b) => b - a)).toEqual([50001, 49999, 49998]);
    expect(view!.asks.map((l) => l.price).sort((a, b) => a - b)).toEqual([50001, 50003]);
    expect(view!.sequence).toBe(101);
  });

  it('skips out-of-order updates (sequence <= current)', () => {
    const store = new InMemoryOrderBookStore();
    store.applySnapshot(URI, baseSnap);

    store.applyUpdate(URI, {
      venue: 'coinbase',
      symbol: 'BTC-USD',
      sequence: 99, // older than snapshot
      timestamp: '2026-05-02T11:59:00.000Z',
      changes: [{ side: 'buy', price: 50000, size: 0 }], // would remove top bid
    });

    const tob = store.getTopOfBook(URI);
    expect(tob!.bidPrice).toBe(50000); // unchanged
  });

  it('applyUpdate to unknown URI is a no-op (waiting for snapshot)', () => {
    const store = new InMemoryOrderBookStore();
    store.applyUpdate(URI, {
      venue: 'coinbase',
      symbol: 'BTC-USD',
      sequence: 1,
      timestamp: '2026-05-02T12:00:00.000Z',
      changes: [{ side: 'buy', price: 100, size: 1 }],
    });
    expect(store.has(URI)).toBe(false);
  });

  it('markStale sets stale flag and reason; markFresh clears them', () => {
    const store = new InMemoryOrderBookStore();
    store.applySnapshot(URI, baseSnap);

    store.markStale(URI, 'sequence_gap');
    expect(store.isStale(URI)).toBe(true);
    expect(store.getTopOfBook(URI)!.stale).toBe(true);
    expect(store.getTopOfBook(URI)!.staleReason).toBe('sequence_gap');

    store.markFresh(URI);
    expect(store.isStale(URI)).toBe(false);
    expect(store.getTopOfBook(URI)!.stale).toBe(false);
    expect(store.getTopOfBook(URI)!.staleReason).toBeUndefined();
  });

  it('snapshot replaces (not merges) prior state', () => {
    const store = new InMemoryOrderBookStore();
    store.applySnapshot(URI, baseSnap);
    store.applySnapshot(URI, {
      ...baseSnap,
      sequence: 200,
      bids: [{ price: 60000, size: 1 }],
      asks: [{ price: 60001, size: 1 }],
    });

    const view = store.getView(URI, 10);
    expect(view!.bids).toHaveLength(1);
    expect(view!.bids[0].price).toBe(60000);
    expect(view!.asks).toHaveLength(1);
    expect(view!.sequence).toBe(200);
  });

  it('top of book returns null sides when book is empty', () => {
    const store = new InMemoryOrderBookStore();
    store.applySnapshot(URI, { ...baseSnap, bids: [], asks: [] });

    const tob = store.getTopOfBook(URI);
    expect(tob!.bidPrice).toBeNull();
    expect(tob!.askPrice).toBeNull();
    expect(tob!.mid).toBeNull();
    expect(tob!.spread).toBeNull();
  });
});

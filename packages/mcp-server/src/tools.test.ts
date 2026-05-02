import { describe, expect, it } from 'vitest';
import { InMemoryOrderBookStore } from '@silver8/core-memory';
import {
  bookSnapshotSchema,
  describeTopic,
  getBookSnapshot,
  getTopOfBook,
  listConfiguredTopics,
  topOfBookSchema,
  type ToolDeps,
} from './tools.js';

const SYMBOLS = ['BTC-USD', 'ETH-USD', 'SOL-USD'];

function makeDeps(): ToolDeps {
  const store = new InMemoryOrderBookStore();
  store.applySnapshot('market://coinbase/book/BTC-USD' as never, {
    venue: 'coinbase',
    symbol: 'BTC-USD',
    sequence: 100,
    timestamp: '2026-05-02T12:00:00.000Z',
    bids: [{ price: 50000, size: 1 }, { price: 49999, size: 2 }, { price: 49998, size: 3 }],
    asks: [{ price: 50001, size: 0.5 }, { price: 50002, size: 1 }],
  });
  return { store, configuredSymbols: SYMBOLS };
}

describe('listConfiguredTopics', () => {
  it('returns one topic per configured symbol with valid market:// URIs', () => {
    const out = listConfiguredTopics(makeDeps());
    expect(out).toHaveLength(3);
    expect(out[0].uri).toBe('market://coinbase/book/BTC-USD');
    expect(out.every((t) => t.kind === 'book' && t.venue === 'coinbase')).toBe(true);
    expect(out.every((t) => t.description.length > 10)).toBe(true);
  });
});

describe('describeTopic', () => {
  it('returns schema, cadence, example, and freshness for a valid URI', () => {
    const result = describeTopic({ uri: 'market://coinbase/book/BTC-USD' }, makeDeps());
    expect(result.uri).toBe('market://coinbase/book/BTC-USD');
    expect(result.symbol).toBe('BTC-USD');
    expect(result.examplePayload).toBeDefined();
    expect(result.freshness.sequence).toBe(100);
  });

  it('throws actionable error on unknown symbol', () => {
    expect(() =>
      describeTopic({ uri: 'market://coinbase/book/UNKNOWN' }, makeDeps()),
    ).toThrow(/unknown symbol UNKNOWN; available symbols: BTC-USD, ETH-USD, SOL-USD/);
  });
});

describe('topOfBookSchema validation', () => {
  it('accepts a valid symbol', () => {
    const schema = topOfBookSchema(SYMBOLS);
    const r = schema.safeParse({ symbol: 'BTC-USD' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.venue).toBe('coinbase'); // default
  });

  it('rejects an unknown symbol with a list of valid ones', () => {
    const schema = topOfBookSchema(SYMBOLS);
    const r = schema.safeParse({ symbol: 'BTC-USDT' });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0].message).toMatch(/available: BTC-USD, ETH-USD, SOL-USD/);
    }
  });
});

describe('getTopOfBook', () => {
  it('returns the top of book from the store', () => {
    const tob = getTopOfBook({ symbol: 'BTC-USD', venue: 'coinbase' }, makeDeps());
    expect(tob.bidPrice).toBe(50000);
    expect(tob.askPrice).toBe(50001);
    expect(tob.mid).toBe(50000.5);
    expect(tob.stale).toBe(false);
  });

  it('throws actionable error when no snapshot has arrived', () => {
    expect(() =>
      getTopOfBook({ symbol: 'ETH-USD', venue: 'coinbase' }, makeDeps()),
    ).toThrow(/no book state yet for ETH-USD/);
  });
});

describe('bookSnapshotSchema + getBookSnapshot', () => {
  it('respects requested depth', () => {
    const schema = bookSnapshotSchema(SYMBOLS);
    const args = schema.parse({ symbol: 'BTC-USD', depth: 2 });
    const view = getBookSnapshot(args, makeDeps());
    expect(view.bids).toHaveLength(2);
    expect(view.bids.map((l) => l.price)).toEqual([50000, 49999]);
  });

  it('defaults depth to 10 when omitted', () => {
    const schema = bookSnapshotSchema(SYMBOLS);
    const args = schema.parse({ symbol: 'BTC-USD' });
    expect(args.depth).toBe(10);
  });

  it('rejects depth out of range', () => {
    const schema = bookSnapshotSchema(SYMBOLS);
    expect(schema.safeParse({ symbol: 'BTC-USD', depth: 100 }).success).toBe(false);
    expect(schema.safeParse({ symbol: 'BTC-USD', depth: 0 }).success).toBe(false);
  });
});

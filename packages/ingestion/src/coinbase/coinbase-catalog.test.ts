import { describe, expect, it } from 'vitest';
import { CoinbaseAdapter, type CoinbaseAdapterConfig } from './coinbase.adapter.js';
import { CoinbaseProtocolHandler } from './coinbase.protocol-handler.js';
import { BookMaintainer } from '../book/book-maintainer.js';
import {
  InMemoryBus,
  InMemoryOrderBookStore,
} from '@silver8/core-memory';
import type { ResourceURI } from '@silver8/core';
import { COINBASE_DEFAULT_SYMBOLS } from './coinbase-catalog.js';

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  trace: () => {},
  child: function () { return this; },
} as never;

function makeAdapter(symbols: readonly string[] = ['BTC-USD', 'ETH-USD']): CoinbaseAdapter {
  const cfg: CoinbaseAdapterConfig = {
    url: 'wss://example.invalid',
    symbols: [...symbols],
    heartbeatTimeoutMs: 30_000,
    reconnectInitialMs: 1_000,
    reconnectMaxMs: 30_000,
    socketIdleMs: 0,
  };
  const maintainer = new BookMaintainer(
    new InMemoryBus(),
    new InMemoryOrderBookStore(),
    noopLogger,
  );
  const handler = new CoinbaseProtocolHandler(maintainer, noopLogger);
  return new CoinbaseAdapter(cfg, handler, noopLogger);
}

describe('CoinbaseAdapter — VenueAdapterCatalog (DEC-030 / DEC-031)', () => {
  it('lists configured symbols as TopicDescriptor entries', () => {
    const adapter = makeAdapter(['BTC-USD', 'ETH-USD', 'SOL-USD']);
    const catalog = adapter.listCatalog();
    expect(catalog).toHaveLength(3);
    expect(catalog[0]).toMatchObject({
      uri: 'market://coinbase/book/BTC-USD',
      kind: 'book',
      venue: 'coinbase',
      symbol: 'BTC-USD',
    });
    expect(catalog.every((entry) => entry.description.length > 10)).toBe(true);
  });

  it('describes a known catalog entry by URI', () => {
    const adapter = makeAdapter();
    const entry = adapter.describeCatalogEntry('market://coinbase/book/BTC-USD' as ResourceURI);
    expect(entry).toBeDefined();
    expect(entry?.symbol).toBe('BTC-USD');
  });

  it('returns undefined for an unknown catalog URI', () => {
    const adapter = makeAdapter();
    const entry = adapter.describeCatalogEntry('market://coinbase/book/UNKNOWN-USD' as ResourceURI);
    expect(entry).toBeUndefined();
  });

  it('reports catalogReady=true synchronously after construction (DEC-033 hardcoded path)', () => {
    const adapter = makeAdapter();
    expect(adapter.catalogReady).toBe(true);
  });

  it('exposes the production default symbol list when constructed with the constant', () => {
    const adapter = makeAdapter(COINBASE_DEFAULT_SYMBOLS);
    const symbols = adapter.listCatalog().map((entry) => entry.symbol);
    expect(symbols).toEqual([...COINBASE_DEFAULT_SYMBOLS]);
    expect(symbols).toContain('BTC-USD');
    expect(symbols).toContain('ETH-USD');
  });
});

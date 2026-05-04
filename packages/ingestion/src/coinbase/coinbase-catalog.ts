import {
  buildResourceUri,
  type Symbol,
  type TopicDescriptor,
} from '@silver8/core';

/**
 * Coinbase catalog source (DEC-031).
 *
 * Hardcoded list of common pairs. Not user-configurable in v1 — the operator
 * decision was that a few common pairs is enough for the assessment, and an
 * env-var allowlist is gratuitous configurability for v1. Coinbase REST
 * `/products` discovery is the documented upgrade path; see DEC-031 for the
 * deferral rationale.
 *
 * Tests inject their own symbol lists via DI; this constant is the production
 * default that the Ingestion module reads at bootstrap.
 */
export const COINBASE_DEFAULT_SYMBOLS: readonly Symbol[] = [
  'BTC-USD',
  'ETH-USD',
  'SOL-USD',
  'AVAX-USD',
  'DOGE-USD',
  'XRP-USD',
  'LINK-USD',
  'MATIC-USD',
] as const;

/**
 * Build catalog descriptors from a symbol list. Used by CoinbaseAdapter and
 * by tests that want to construct a TopicDescriptor[] without instantiating
 * the full adapter.
 */
export function buildCoinbaseCatalog(
  symbols: readonly Symbol[],
): readonly TopicDescriptor[] {
  return symbols.map((symbol) => ({
    uri: buildResourceUri('coinbase', 'book', symbol),
    kind: 'book',
    venue: 'coinbase',
    symbol,
    description:
      `Top-of-book and depth-N L2 order book for ${symbol} on Coinbase. ` +
      `Updates on every level change.`,
  }));
}

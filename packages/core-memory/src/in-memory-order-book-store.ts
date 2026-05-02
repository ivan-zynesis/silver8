import type {
  BookLevel,
  BookSnapshotInput,
  BookUpdateInput,
  BookView,
  OrderBookStore,
  ResourceURI,
  TopOfBook,
} from '@silver8/core';
import { parseResourceUri } from '@silver8/core';

interface BookState {
  /** Bids keyed by price, value is size. */
  bids: Map<number, number>;
  asks: Map<number, number>;
  sequence: number;
  timestamp: string;
  stale: boolean;
  staleReason?: string;
}

/**
 * In-memory L2 book per URI. Snapshot replaces the entire book; updates apply
 * per-level deltas (size=0 removes the level). Implementations skip out-of-order
 * updates (lower sequence than current) to preserve correctness during resync.
 *
 * Sorting is computed on read (top-N), not stored, because v1 only requires
 * shallow depth queries (≤ 50 levels). For higher depths a sorted structure
 * (skip list or order-statistic tree) would be warranted.
 */
export class InMemoryOrderBookStore implements OrderBookStore {
  private readonly books = new Map<ResourceURI, BookState>();

  applySnapshot(uri: ResourceURI, snap: BookSnapshotInput): void {
    const state: BookState = {
      bids: new Map(),
      asks: new Map(),
      sequence: snap.sequence,
      timestamp: snap.timestamp,
      stale: false,
    };
    for (const lvl of snap.bids) {
      if (lvl.size > 0) state.bids.set(lvl.price, lvl.size);
    }
    for (const lvl of snap.asks) {
      if (lvl.size > 0) state.asks.set(lvl.price, lvl.size);
    }
    this.books.set(uri, state);
  }

  applyUpdate(uri: ResourceURI, upd: BookUpdateInput): void {
    const state = this.books.get(uri);
    if (!state) {
      // No snapshot yet; the update is meaningless. Adapter will resync.
      return;
    }
    if (upd.sequence <= state.sequence) {
      // Out-of-order or duplicate; skip.
      return;
    }
    for (const change of upd.changes) {
      const side = change.side === 'buy' ? state.bids : state.asks;
      if (change.size === 0) {
        side.delete(change.price);
      } else {
        side.set(change.price, change.size);
      }
    }
    state.sequence = upd.sequence;
    state.timestamp = upd.timestamp;
  }

  markStale(uri: ResourceURI, reason: string): void {
    const state = this.books.get(uri);
    if (!state) return;
    state.stale = true;
    state.staleReason = reason;
  }

  markFresh(uri: ResourceURI): void {
    const state = this.books.get(uri);
    if (!state) return;
    state.stale = false;
    delete state.staleReason;
  }

  has(uri: ResourceURI): boolean {
    return this.books.has(uri);
  }

  isStale(uri: ResourceURI): boolean {
    return this.books.get(uri)?.stale ?? false;
  }

  getTopOfBook(uri: ResourceURI): TopOfBook | undefined {
    const state = this.books.get(uri);
    if (!state) return undefined;
    const { venue, symbol } = parseResourceUri(uri);

    const bestBid = bestPriceLevel(state.bids, 'desc');
    const bestAsk = bestPriceLevel(state.asks, 'asc');

    const bidPrice = bestBid?.price ?? null;
    const askPrice = bestAsk?.price ?? null;
    const mid = bidPrice !== null && askPrice !== null ? (bidPrice + askPrice) / 2 : null;
    const spread = bidPrice !== null && askPrice !== null ? askPrice - bidPrice : null;

    return {
      venue,
      symbol,
      bidPrice,
      bidSize: bestBid?.size ?? null,
      askPrice,
      askSize: bestAsk?.size ?? null,
      mid,
      spread,
      sequence: state.sequence,
      timestamp: state.timestamp,
      stale: state.stale,
      ...(state.staleReason ? { staleReason: state.staleReason } : {}),
    };
  }

  getView(uri: ResourceURI, depth: number): BookView | undefined {
    const state = this.books.get(uri);
    if (!state) return undefined;
    const { venue, symbol } = parseResourceUri(uri);

    return {
      venue,
      symbol,
      bids: topNLevels(state.bids, 'desc', depth),
      asks: topNLevels(state.asks, 'asc', depth),
      sequence: state.sequence,
      timestamp: state.timestamp,
      stale: state.stale,
      ...(state.staleReason ? { staleReason: state.staleReason } : {}),
    };
  }

  knownTopics(): readonly ResourceURI[] {
    return Array.from(this.books.keys());
  }
}

function bestPriceLevel(side: Map<number, number>, order: 'asc' | 'desc'): BookLevel | undefined {
  let bestPrice: number | undefined;
  for (const price of side.keys()) {
    if (bestPrice === undefined) {
      bestPrice = price;
      continue;
    }
    if (order === 'desc' ? price > bestPrice : price < bestPrice) {
      bestPrice = price;
    }
  }
  if (bestPrice === undefined) return undefined;
  const size = side.get(bestPrice);
  if (size === undefined) return undefined;
  return { price: bestPrice, size };
}

function topNLevels(
  side: Map<number, number>,
  order: 'asc' | 'desc',
  depth: number,
): BookLevel[] {
  const entries = Array.from(side.entries(), ([price, size]) => ({ price, size }));
  entries.sort((a, b) => (order === 'desc' ? b.price - a.price : a.price - b.price));
  return entries.slice(0, Math.max(0, depth));
}

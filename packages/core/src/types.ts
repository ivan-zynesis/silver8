// Domain types for the market-data hub.
// Venue-agnostic where possible; venue adapters translate from native shapes.

export type Venue = 'coinbase';
export type Symbol = string; // e.g., "BTC-USD"
export type ChannelKind = 'book'; // v1 only; "trades" / "ticker" reserved for future

export interface BookLevel {
  /** Price in quote currency. */
  price: number;
  /** Size in base currency (zero size = level removed). */
  size: number;
}

export interface BookView {
  venue: Venue;
  symbol: Symbol;
  /** Bids sorted descending by price (best first). */
  bids: BookLevel[];
  /** Asks sorted ascending by price (best first). */
  asks: BookLevel[];
  /** Latest applied sequence number from the venue. */
  sequence: number;
  /** Server-side timestamp of the latest applied event. ISO 8601. */
  timestamp: string;
  /** True when the upstream feed has gapped or gone silent and a resync is in progress. */
  stale: boolean;
  /** Populated when stale=true. */
  staleReason?: string;
}

export interface TopOfBook {
  venue: Venue;
  symbol: Symbol;
  bidPrice: number | null;
  bidSize: number | null;
  askPrice: number | null;
  askSize: number | null;
  /** (bidPrice + askPrice) / 2 when both sides present; else null. */
  mid: number | null;
  /** askPrice - bidPrice when both present; else null. */
  spread: number | null;
  sequence: number;
  timestamp: string;
  stale: boolean;
  staleReason?: string;
}

export interface BookSnapshotInput {
  venue: Venue;
  symbol: Symbol;
  bids: BookLevel[];
  asks: BookLevel[];
  sequence: number;
  timestamp: string;
}

export interface BookUpdateInput {
  venue: Venue;
  symbol: Symbol;
  /** Per-level changes; size=0 means remove the level. */
  changes: Array<{ side: 'buy' | 'sell'; price: number; size: number }>;
  sequence: number;
  timestamp: string;
}

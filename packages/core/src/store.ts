import type { BookSnapshotInput, BookUpdateInput, BookView, TopOfBook } from './types.js';
import type { ResourceURI } from './uri.js';

/**
 * OrderBookStore holds the L2 order book state for every active topic.
 * Single source of truth (DEC-009): consumers read from here for snapshots; the
 * Bus carries change notifications + view payloads, but the store is canonical.
 *
 * Implementations are responsible for keeping bids sorted descending and asks
 * sorted ascending. Top-N reads truncate to the requested depth.
 */
export interface OrderBookStore {
  /** Replace the entire book (initial snapshot or post-resync). */
  applySnapshot(uri: ResourceURI, snap: BookSnapshotInput): void;

  /** Apply incremental changes. Implementations skip out-of-order updates. */
  applyUpdate(uri: ResourceURI, upd: BookUpdateInput): void;

  /** Mark the topic stale (sequence gap, heartbeat timeout, upstream disconnect). */
  markStale(uri: ResourceURI, reason: string): void;
  /** Clear the stale flag (post-resync). */
  markFresh(uri: ResourceURI): void;

  /** True when applySnapshot has been called at least once for this URI. */
  has(uri: ResourceURI): boolean;
  /** True when the topic is currently flagged stale. */
  isStale(uri: ResourceURI): boolean;

  getTopOfBook(uri: ResourceURI): TopOfBook | undefined;
  /** Returns the top-N levels per side (truncated to `depth`). */
  getView(uri: ResourceURI, depth: number): BookView | undefined;

  /** All URIs the store currently has state for. */
  knownTopics(): readonly ResourceURI[];
}

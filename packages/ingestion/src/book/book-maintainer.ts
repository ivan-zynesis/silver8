import { Inject, Injectable } from '@nestjs/common';
import {
  BUS,
  LOGGER,
  ORDER_BOOK_STORE,
  type Bus,
  type BookSnapshotInput,
  type BookUpdateInput,
  type BusMessage,
  type OrderBookStore,
  type ResourceURI,
} from '@silver8/core';
import { sequenceGaps, upstreamMessages } from '@silver8/observability';
import type { Logger } from '@silver8/observability';

/**
 * Owns the OrderBookStore writes (DEC-009): every snapshot and update funnels
 * through here. Also publishes the corresponding Bus message after the store
 * mutation, so subscribers see a state that's been committed to the canonical
 * store before they observe the change event.
 *
 * View depth for Bus payloads is configurable; consumers interested in deeper
 * books read the OrderBookStore directly (gateway/MCP both do).
 */
@Injectable()
export class BookMaintainer {
  /** Top-N depth published in Bus messages. Consumers can read deeper from store. */
  private readonly publishedDepth = 50;

  constructor(
    @Inject(BUS) private readonly bus: Bus,
    @Inject(ORDER_BOOK_STORE) private readonly store: OrderBookStore,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  async applySnapshot(uri: ResourceURI, snap: BookSnapshotInput): Promise<void> {
    const wasStale = this.store.isStale(uri);
    this.store.applySnapshot(uri, snap);
    this.store.markFresh(uri);
    upstreamMessages.inc({ venue: snap.venue, kind: 'snapshot' });

    const view = this.store.getView(uri, this.publishedDepth);
    if (!view) return;

    const msg: BusMessage = { kind: 'book.snapshot', uri, view };
    await this.bus.publish(uri, msg);

    // If this snapshot recovered the topic from stale, emit a transition signal so
    // gateway / MCP can clear their stale-state notifications to consumers.
    if (wasStale) {
      await this.bus.publish(uri, { kind: 'book.fresh', uri });
    }
    this.logger.debug(
      { uri, sequence: snap.sequence, recoveredFromStale: wasStale },
      'snapshot applied',
    );
  }

  async applyUpdate(uri: ResourceURI, upd: BookUpdateInput): Promise<void> {
    if (!this.store.has(uri)) {
      // Update arrived before snapshot — adapter will trigger resync; drop here.
      this.logger.warn({ uri, sequence: upd.sequence }, 'update before snapshot; dropped');
      return;
    }
    const before = this.store.getTopOfBook(uri)?.sequence ?? -1;
    this.store.applyUpdate(uri, upd);
    const after = this.store.getTopOfBook(uri)?.sequence ?? -1;
    if (after === before) {
      // Out-of-order; store rejected. Don't publish.
      return;
    }
    upstreamMessages.inc({ venue: upd.venue, kind: 'update' });

    const view = this.store.getView(uri, this.publishedDepth);
    if (!view) return;

    const msg: BusMessage = { kind: 'book.update', uri, view };
    await this.bus.publish(uri, msg);
  }

  async markStale(uri: ResourceURI, reason: string): Promise<void> {
    if (!this.store.has(uri)) return;
    if (this.store.isStale(uri)) return; // already stale

    this.store.markStale(uri, reason);
    sequenceGaps.inc({ venue: 'coinbase', symbol: extractSymbol(uri) });
    await this.bus.publish(uri, { kind: 'book.stale', uri, reason });
    this.logger.warn({ uri, reason }, 'topic marked stale');
  }

  async markFresh(uri: ResourceURI): Promise<void> {
    if (!this.store.has(uri)) return;
    if (!this.store.isStale(uri)) return;

    this.store.markFresh(uri);
    await this.bus.publish(uri, { kind: 'book.fresh', uri });
    this.logger.info({ uri }, 'topic fresh');
  }

  async markAllStale(uris: readonly ResourceURI[], reason: string): Promise<void> {
    await Promise.all(uris.map((u) => this.markStale(u, reason)));
  }
}

function extractSymbol(uri: ResourceURI): string {
  // market://venue/kind/symbol — symbol is everything after the last slash.
  const idx = uri.lastIndexOf('/');
  return idx >= 0 ? uri.slice(idx + 1) : uri;
}

import { Inject, Injectable } from '@nestjs/common';
import { LOGGER, type ResourceURI } from '@silver8/core';
import type { Logger } from '@silver8/observability';
import { BookMaintainer } from '../book/book-maintainer.js';
import { parseEnvelope, type ParsedFrame } from './coinbase.parser.js';

export interface ProtocolHandlerEvents {
  /** Fired when a sequence-number gap is detected; adapter should resync upstream. */
  onSequenceGap: (gap: SequenceGap) => Promise<void> | void;
  /** Fired on every successfully-parsed message; adapter can pet its watchdog. */
  onMessage: () => void;
}

export interface SequenceGap {
  expectedSeq: number;
  receivedSeq: number;
  affectedTopics: readonly ResourceURI[];
}

/**
 * Protocol-level handler for the Coinbase Advanced Trade WebSocket feed.
 *
 * Pure-logic boundary: takes already-decoded JSON envelopes and the topics it
 * cares about; produces side effects on the OrderBookStore + Bus via
 * BookMaintainer, and delegates connection management back to its host adapter
 * via the events callback (sequence gaps trigger resubscribe upstream).
 *
 * Sequence semantics (per Coinbase Advanced Trade docs): `sequence_num` is
 * monotonic per-subscription. A gap on the connection means we may have lost
 * events for any of the products on that subscription; we conservatively mark
 * every subscribed topic stale until resync produces fresh snapshots.
 */
@Injectable()
export class CoinbaseProtocolHandler {
  private lastSeq: number | null = null;
  private subscribedTopics = new Set<ResourceURI>();
  private events: ProtocolHandlerEvents | null = null;

  constructor(
    private readonly maintainer: BookMaintainer,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  setEvents(events: ProtocolHandlerEvents): void {
    this.events = events;
  }

  setSubscribedTopics(topics: Iterable<ResourceURI>): void {
    this.subscribedTopics = new Set(topics);
  }

  /** Reset sequence baseline — called after the adapter performs a fresh subscribe. */
  resetSequence(): void {
    this.lastSeq = null;
  }

  /** Process a raw decoded message envelope. */
  async handle(raw: unknown): Promise<void> {
    const result = parseEnvelope(raw);

    this.events?.onMessage();

    // Sequence-gap check (only when we have a baseline). Subscriptions / heartbeats
    // share the sequence space with l2_data, so we track all envelopes uniformly.
    if (this.lastSeq !== null && result.sequenceNum > 0) {
      const expected = this.lastSeq + 1;
      if (result.sequenceNum !== expected) {
        const gap: SequenceGap = {
          expectedSeq: expected,
          receivedSeq: result.sequenceNum,
          affectedTopics: Array.from(this.subscribedTopics),
        };
        this.logger.warn({ gap }, 'sequence gap detected; resync requested');
        // Mark stale before notifying adapter so consumers see stale before resync starts.
        await this.maintainer.markAllStale(gap.affectedTopics, 'sequence_gap');
        await this.events?.onSequenceGap(gap);
        // Sequence baseline reset will be handled by the adapter via resetSequence()
        // once it has performed the resubscribe.
        this.lastSeq = result.sequenceNum;
        return;
      }
    }
    if (result.sequenceNum >= 0) {
      this.lastSeq = result.sequenceNum;
    }

    for (const frame of result.frames) {
      await this.processFrame(frame);
    }
  }

  private async processFrame(frame: ParsedFrame): Promise<void> {
    switch (frame.kind) {
      case 'l2.snapshot':
        // applySnapshot handles the stale→fresh transition internally.
        await this.maintainer.applySnapshot(frame.uri, frame.snap);
        break;
      case 'l2.update':
        await this.maintainer.applyUpdate(frame.uri, frame.upd);
        break;
      case 'heartbeat':
        // Watchdog already pet by onMessage; nothing else to do.
        break;
      case 'subscriptions':
        this.logger.debug({ active: frame.active }, 'coinbase subscription state');
        break;
      case 'ignored':
        this.logger.debug({ reason: frame.reason }, 'frame ignored');
        break;
    }
  }
}

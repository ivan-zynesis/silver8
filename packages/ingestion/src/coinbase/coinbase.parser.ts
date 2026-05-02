import type {
  BookSnapshotInput,
  BookUpdateInput,
  ResourceURI,
} from '@silver8/core';
import { buildResourceUri } from '@silver8/core';
import type {
  CoinbaseEnvelope,
  CoinbaseL2Event,
  CoinbaseL2Update,
} from './coinbase.types.js';

export type ParsedFrame =
  | { kind: 'l2.snapshot'; uri: ResourceURI; snap: BookSnapshotInput }
  | { kind: 'l2.update'; uri: ResourceURI; upd: BookUpdateInput }
  | { kind: 'heartbeat'; counter: number; serverTime: string }
  | { kind: 'subscriptions'; active: Record<string, string[]> }
  | { kind: 'ignored'; reason: string };

export interface ParseResult {
  /** Parsed semantic frames extracted from the envelope. */
  frames: ParsedFrame[];
  /** Sequence number from the envelope; used for gap detection. */
  sequenceNum: number;
  /** Channel name from envelope; useful for routing. */
  channel: string;
}

/**
 * Parse a single WS frame (already JSON-decoded) from Coinbase's Advanced Trade
 * feed into normalized `ParsedFrame`s. The parser is pure and does no I/O.
 *
 * Coinbase delivers `events: []` arrays inside an envelope; one envelope can
 * carry multiple per-product events. We expand to one ParsedFrame per event.
 */
export function parseEnvelope(raw: unknown): ParseResult {
  if (!isEnvelope(raw)) {
    return { frames: [{ kind: 'ignored', reason: 'not an envelope' }], sequenceNum: -1, channel: 'unknown' };
  }
  const envelope = raw;

  if (envelope.channel === 'l2_data') {
    const frames: ParsedFrame[] = [];
    for (const ev of envelope.events) {
      if (!isL2Event(ev)) {
        frames.push({ kind: 'ignored', reason: 'malformed l2 event' });
        continue;
      }
      const uri = buildResourceUri('coinbase', 'book', ev.product_id);
      if (ev.type === 'snapshot') {
        frames.push({
          kind: 'l2.snapshot',
          uri,
          snap: {
            venue: 'coinbase',
            symbol: ev.product_id,
            sequence: envelope.sequence_num,
            timestamp: envelope.timestamp,
            bids: ev.updates
              .filter((u) => u.side === 'bid')
              .map(toLevel),
            asks: ev.updates
              .filter((u) => u.side === 'offer')
              .map(toLevel),
          },
        });
      } else {
        frames.push({
          kind: 'l2.update',
          uri,
          upd: {
            venue: 'coinbase',
            symbol: ev.product_id,
            sequence: envelope.sequence_num,
            timestamp: envelope.timestamp,
            changes: ev.updates.map((u) => ({
              side: u.side === 'bid' ? 'buy' : 'sell',
              price: parseFloat(u.price_level),
              size: parseFloat(u.new_quantity),
            })),
          },
        });
      }
    }
    return { frames, sequenceNum: envelope.sequence_num, channel: envelope.channel };
  }

  if (envelope.channel === 'heartbeats') {
    const frames: ParsedFrame[] = [];
    for (const ev of envelope.events) {
      if (typeof ev === 'object' && ev !== null && 'heartbeat_counter' in ev) {
        frames.push({
          kind: 'heartbeat',
          counter: Number((ev as { heartbeat_counter: number }).heartbeat_counter),
          serverTime: envelope.timestamp,
        });
      }
    }
    return { frames, sequenceNum: envelope.sequence_num, channel: envelope.channel };
  }

  if (envelope.channel === 'subscriptions') {
    const frames: ParsedFrame[] = [];
    for (const ev of envelope.events) {
      if (typeof ev === 'object' && ev !== null && 'subscriptions' in ev) {
        frames.push({
          kind: 'subscriptions',
          active: (ev as { subscriptions: Record<string, string[]> }).subscriptions,
        });
      }
    }
    return { frames, sequenceNum: envelope.sequence_num, channel: envelope.channel };
  }

  return {
    frames: [{ kind: 'ignored', reason: `unhandled channel: ${envelope.channel}` }],
    sequenceNum: envelope.sequence_num,
    channel: envelope.channel,
  };
}

function toLevel(u: CoinbaseL2Update): { price: number; size: number } {
  return { price: parseFloat(u.price_level), size: parseFloat(u.new_quantity) };
}

function isEnvelope(v: unknown): v is CoinbaseEnvelope {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.channel === 'string' &&
    typeof o.timestamp === 'string' &&
    typeof o.sequence_num === 'number' &&
    Array.isArray(o.events)
  );
}

function isL2Event(v: unknown): v is CoinbaseL2Event {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    (o.type === 'snapshot' || o.type === 'update') &&
    typeof o.product_id === 'string' &&
    Array.isArray(o.updates)
  );
}

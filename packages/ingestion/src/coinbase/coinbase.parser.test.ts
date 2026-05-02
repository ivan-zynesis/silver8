import { describe, expect, it } from 'vitest';
import { parseEnvelope } from './coinbase.parser.js';

describe('parseEnvelope', () => {
  it('parses an l2_data snapshot', () => {
    const envelope = {
      channel: 'l2_data',
      timestamp: '2026-05-02T12:00:00.000Z',
      sequence_num: 5,
      events: [
        {
          type: 'snapshot',
          product_id: 'BTC-USD',
          updates: [
            { side: 'bid', event_time: 't', price_level: '50000.00', new_quantity: '1.5' },
            { side: 'offer', event_time: 't', price_level: '50001.00', new_quantity: '0.5' },
          ],
        },
      ],
    };

    const result = parseEnvelope(envelope);
    expect(result.sequenceNum).toBe(5);
    expect(result.frames).toHaveLength(1);
    const frame = result.frames[0];
    if (frame.kind !== 'l2.snapshot') throw new Error('expected snapshot');
    expect(frame.uri).toBe('market://coinbase/book/BTC-USD');
    expect(frame.snap.sequence).toBe(5);
    expect(frame.snap.bids).toEqual([{ price: 50000, size: 1.5 }]);
    expect(frame.snap.asks).toEqual([{ price: 50001, size: 0.5 }]);
  });

  it('parses an l2_data update with mixed sides', () => {
    const envelope = {
      channel: 'l2_data',
      timestamp: '2026-05-02T12:00:01.000Z',
      sequence_num: 6,
      events: [
        {
          type: 'update',
          product_id: 'ETH-USD',
          updates: [
            { side: 'bid', event_time: 't', price_level: '3000', new_quantity: '0' },
            { side: 'offer', event_time: 't', price_level: '3001', new_quantity: '2.5' },
          ],
        },
      ],
    };
    const result = parseEnvelope(envelope);
    const frame = result.frames[0];
    if (frame.kind !== 'l2.update') throw new Error('expected update');
    expect(frame.uri).toBe('market://coinbase/book/ETH-USD');
    expect(frame.upd.changes).toEqual([
      { side: 'buy', price: 3000, size: 0 },
      { side: 'sell', price: 3001, size: 2.5 },
    ]);
  });

  it('expands envelopes with multiple events', () => {
    const envelope = {
      channel: 'l2_data',
      timestamp: '2026-05-02T12:00:02.000Z',
      sequence_num: 7,
      events: [
        { type: 'update', product_id: 'BTC-USD', updates: [] },
        { type: 'update', product_id: 'ETH-USD', updates: [] },
      ],
    };
    const result = parseEnvelope(envelope);
    expect(result.frames).toHaveLength(2);
    expect(result.frames.map((f) => f.kind)).toEqual(['l2.update', 'l2.update']);
  });

  it('parses heartbeat envelopes', () => {
    const envelope = {
      channel: 'heartbeats',
      timestamp: '2026-05-02T12:00:03.000Z',
      sequence_num: 8,
      events: [{ current_time: '...', heartbeat_counter: 42 }],
    };
    const result = parseEnvelope(envelope);
    const frame = result.frames[0];
    if (frame.kind !== 'heartbeat') throw new Error('expected heartbeat');
    expect(frame.counter).toBe(42);
  });

  it('parses subscriptions envelopes', () => {
    const envelope = {
      channel: 'subscriptions',
      timestamp: '2026-05-02T12:00:04.000Z',
      sequence_num: 9,
      events: [{ subscriptions: { level2: ['BTC-USD'] } }],
    };
    const result = parseEnvelope(envelope);
    const frame = result.frames[0];
    if (frame.kind !== 'subscriptions') throw new Error('expected subscriptions');
    expect(frame.active.level2).toEqual(['BTC-USD']);
  });

  it('returns ignored frame for unknown channel', () => {
    const envelope = {
      channel: 'matches',
      timestamp: '2026-05-02T12:00:05.000Z',
      sequence_num: 10,
      events: [{}],
    };
    const result = parseEnvelope(envelope);
    expect(result.frames[0].kind).toBe('ignored');
  });

  it('returns ignored frame for non-envelope input', () => {
    const result = parseEnvelope({ random: 'shape' });
    expect(result.frames[0].kind).toBe('ignored');
    expect(result.sequenceNum).toBe(-1);
  });

  it('returns ignored frame for malformed l2 events but processes good ones in same envelope', () => {
    const envelope = {
      channel: 'l2_data',
      timestamp: '2026-05-02T12:00:06.000Z',
      sequence_num: 11,
      events: [
        { type: 'invalid' },
        { type: 'snapshot', product_id: 'BTC-USD', updates: [] },
      ],
    };
    const result = parseEnvelope(envelope);
    expect(result.frames).toHaveLength(2);
    expect(result.frames[0].kind).toBe('ignored');
    expect(result.frames[1].kind).toBe('l2.snapshot');
  });
});

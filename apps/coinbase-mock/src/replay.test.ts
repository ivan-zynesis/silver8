import { describe, expect, it } from 'vitest';
import { ConnectionReplay } from './replay.js';
import type { Envelope } from './fixture.js';

function fixture(): Envelope[] {
  return [
    {
      channel: 'l2_data', timestamp: 't', sequence_num: 1,
      events: [{ type: 'snapshot', product_id: 'BTC-USD', updates: [] }],
    },
    {
      channel: 'l2_data', timestamp: 't', sequence_num: 2,
      events: [{ type: 'snapshot', product_id: 'ETH-USD', updates: [] }],
    },
    {
      channel: 'l2_data', timestamp: 't', sequence_num: 3,
      events: [
        { type: 'update', product_id: 'BTC-USD', updates: [] },
        { type: 'update', product_id: 'ETH-USD', updates: [] },
      ],
    },
    {
      channel: 'heartbeats', timestamp: 't', sequence_num: 4,
      events: [{ current_time: 't', heartbeat_counter: 1 }],
    },
  ];
}

describe('ConnectionReplay', () => {
  it('returns null until any subscription exists', () => {
    const r = new ConnectionReplay(fixture(), false);
    expect(r.next()).toBeNull();
  });

  it('emits only matching products for level2 subs', () => {
    const r = new ConnectionReplay(fixture(), false);
    r.subscribe('level2', ['BTC-USD']);

    const a = r.next();
    expect(a?.channel).toBe('l2_data');
    expect(((a!.events[0] as { product_id: string }).product_id)).toBe('BTC-USD');

    // Next is the multi-product update envelope filtered to BTC-USD only.
    const b = r.next();
    expect(b?.events).toHaveLength(1);
    expect((b!.events[0] as { product_id: string }).product_id).toBe('BTC-USD');

    // Heartbeat is not subscribed; the only remaining match (ETH-only events)
    // is filtered out, so next() returns null.
    expect(r.next()).toBeNull();
  });

  it('rewrites sequence_num to be monotonic per connection', () => {
    const r = new ConnectionReplay(fixture(), false);
    r.subscribe('level2', ['BTC-USD']);
    r.subscribe('heartbeats', []);
    const seqs: number[] = [];
    let env: Envelope | null;
    while ((env = r.next()) !== null) seqs.push(env.sequence_num);
    expect(seqs).toEqual(seqs.slice().sort((a, b) => a - b));
    expect(seqs[0]).toBe(1);
    // Each step is +1.
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i] - seqs[i - 1]).toBe(1);
    }
  });

  it('injectGap skips one sequence number once', () => {
    const r = new ConnectionReplay(fixture(), false);
    r.subscribe('level2', ['BTC-USD', 'ETH-USD']);
    const a = r.next()!;
    expect(a.sequence_num).toBe(1);
    r.injectGap();
    const b = r.next()!;
    // After gap injection, the next emitted env's sequence_num skips one.
    expect(b.sequence_num).toBe(3);
    const c = r.next()!;
    expect(c.sequence_num).toBe(4);
  });

  it('loops back to start when loop=true', () => {
    const r = new ConnectionReplay(fixture(), true);
    r.subscribe('level2', ['BTC-USD']);
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      const env = r.next();
      if (env) seen.push((env.events[0] as { type: string }).type);
    }
    // Walking the BTC-only events: snapshot, update (filtered from multi-product)
    // → loops back to snapshot, update, etc.
    expect(seen.length).toBeGreaterThan(2);
    expect(seen.filter((t) => t === 'snapshot').length).toBeGreaterThan(1);
  });

  it('loop=false stops after one walk', () => {
    const r = new ConnectionReplay(fixture(), false);
    r.subscribe('level2', ['BTC-USD']);
    const all: number[] = [];
    let env: Envelope | null;
    while ((env = r.next()) !== null) all.push(env.sequence_num);
    expect(all.length).toBe(2); // snapshot + update with BTC-USD
  });

  it('subscriptionSnapshot returns the active set', () => {
    const r = new ConnectionReplay(fixture(), false);
    r.subscribe('level2', ['BTC-USD', 'ETH-USD']);
    r.subscribe('heartbeats', []);
    expect(r.subscriptionSnapshot()).toEqual(
      ['heartbeats:*', 'level2:BTC-USD', 'level2:ETH-USD'],
    );
  });

  it('unsubscribe removes from the set; subsequent next() filters them out', () => {
    const r = new ConnectionReplay(fixture(), false);
    r.subscribe('level2', ['BTC-USD', 'ETH-USD']);
    r.unsubscribe('level2', ['ETH-USD']);
    expect(r.subscriptionSnapshot()).toEqual(['level2:BTC-USD']);

    // The multi-product update envelope is now filtered to BTC-USD only.
    r.next(); // snapshot BTC
    const upd = r.next()!;
    expect(upd.events).toHaveLength(1);
    expect((upd.events[0] as { product_id: string }).product_id).toBe('BTC-USD');
  });
});

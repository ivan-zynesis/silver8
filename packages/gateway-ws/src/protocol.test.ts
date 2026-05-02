import { describe, expect, it } from 'vitest';
import { parseClientOp, serializeEvent } from './protocol.js';

describe('parseClientOp', () => {
  it('parses a valid subscribe op', () => {
    const r = parseClientOp(
      JSON.stringify({ op: 'subscribe', resource: 'market://coinbase/book/BTC-USD' }),
    );
    if (!r.ok) throw new Error(r.error);
    if (r.value.op !== 'subscribe') throw new Error('expected subscribe');
    expect(r.value.resource).toBe('market://coinbase/book/BTC-USD');
  });

  it('parses subscribe with correlation id', () => {
    const r = parseClientOp(
      JSON.stringify({ op: 'subscribe', resource: 'market://coinbase/book/ETH-USD', id: 'req-1' }),
    );
    if (!r.ok) throw new Error(r.error);
    if (r.value.op !== 'subscribe') throw new Error('expected subscribe');
    expect(r.value.id).toBe('req-1');
  });

  it('parses unsubscribe op', () => {
    const r = parseClientOp(
      JSON.stringify({ op: 'unsubscribe', resource: 'market://coinbase/book/BTC-USD' }),
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.value.op).toBe('unsubscribe');
  });

  it('parses ping op', () => {
    const r = parseClientOp(JSON.stringify({ op: 'ping' }));
    if (!r.ok) throw new Error(r.error);
    expect(r.value.op).toBe('ping');
  });

  it('rejects unknown op', () => {
    const r = parseClientOp(JSON.stringify({ op: 'sneak', resource: 'market://x/y/z' }));
    expect(r.ok).toBe(false);
  });

  it('rejects malformed JSON', () => {
    const r = parseClientOp('not-json');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/invalid JSON/i);
  });

  it('rejects subscribe with non-market URI', () => {
    const r = parseClientOp(
      JSON.stringify({ op: 'subscribe', resource: 'http://example.com' }),
    );
    expect(r.ok).toBe(false);
  });

  it('rejects subscribe with empty resource', () => {
    const r = parseClientOp(JSON.stringify({ op: 'subscribe', resource: '' }));
    expect(r.ok).toBe(false);
  });
});

describe('serializeEvent', () => {
  it('serializes an ack event', () => {
    const out = serializeEvent({
      event: 'ack',
      op: 'subscribe',
      resource: 'market://coinbase/book/BTC-USD',
      id: 'req-1',
    });
    expect(JSON.parse(out)).toEqual({
      event: 'ack',
      op: 'subscribe',
      resource: 'market://coinbase/book/BTC-USD',
      id: 'req-1',
    });
  });

  it('serializes a rebalance event', () => {
    const out = serializeEvent({
      event: 'rebalance',
      reason: 'shutdown',
      deadlineMs: 30000,
    });
    expect(JSON.parse(out)).toMatchObject({ event: 'rebalance', deadlineMs: 30000 });
  });
});

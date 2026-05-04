import { describe, expect, it, vi } from 'vitest';
import { createSubscriptionMux } from './gateway-connection.js';

describe('createSubscriptionMux — refcount + dispatch', () => {
  it('sends a single subscribe op for the first listener; nothing on later listeners for the same uri', () => {
    const send = vi.fn();
    const mux = createSubscriptionMux(send);

    const off1 = mux.subscribe('market://coinbase/book/BTC-USD', () => {});
    const off2 = mux.subscribe('market://coinbase/book/BTC-USD', () => {});

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('subscribe', 'market://coinbase/book/BTC-USD');
    expect(mux.size()).toBe(1);

    // Cleanup so the test stays self-contained.
    off1();
    off2();
  });

  it('sends unsubscribe only when the last listener leaves', () => {
    const send = vi.fn();
    const mux = createSubscriptionMux(send);

    const off1 = mux.subscribe('market://coinbase/book/ETH-USD', () => {});
    const off2 = mux.subscribe('market://coinbase/book/ETH-USD', () => {});
    send.mockClear(); // forget the initial subscribe

    off1();
    expect(send).not.toHaveBeenCalled();

    off2();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('unsubscribe', 'market://coinbase/book/ETH-USD');
    expect(mux.size()).toBe(0);
  });

  it('handles multiple distinct URIs independently', () => {
    const send = vi.fn();
    const mux = createSubscriptionMux(send);

    const a = mux.subscribe('market://coinbase/book/BTC-USD', () => {});
    const b = mux.subscribe('market://coinbase/book/ETH-USD', () => {});

    expect(send).toHaveBeenNthCalledWith(1, 'subscribe', 'market://coinbase/book/BTC-USD');
    expect(send).toHaveBeenNthCalledWith(2, 'subscribe', 'market://coinbase/book/ETH-USD');
    expect(mux.size()).toBe(2);

    a();
    expect(send).toHaveBeenLastCalledWith('unsubscribe', 'market://coinbase/book/BTC-USD');
    expect(mux.size()).toBe(1);

    b();
    expect(send).toHaveBeenLastCalledWith('unsubscribe', 'market://coinbase/book/ETH-USD');
    expect(mux.size()).toBe(0);
  });

  it('dispatches events with a resource to listeners for that uri only', () => {
    const send = vi.fn();
    const mux = createSubscriptionMux(send);

    const btcSeen: string[] = [];
    const ethSeen: string[] = [];
    mux.subscribe('market://coinbase/book/BTC-USD', (ev) => btcSeen.push(ev.event));
    mux.subscribe('market://coinbase/book/ETH-USD', (ev) => ethSeen.push(ev.event));

    mux.dispatch('market://coinbase/book/BTC-USD', {
      event: 'snapshot',
      resource: 'market://coinbase/book/BTC-USD',
      data: {
        venue: 'coinbase', symbol: 'BTC-USD', bids: [], asks: [],
        sequence: 1, timestamp: 't', stale: false,
      },
      sequence: 1,
      stale: false,
    });

    expect(btcSeen).toEqual(['snapshot']);
    expect(ethSeen).toEqual([]);
  });

  it('broadcasts events without a resource (e.g. rebalance) to every listener', () => {
    const send = vi.fn();
    const mux = createSubscriptionMux(send);

    const btcSeen: string[] = [];
    const ethSeen: string[] = [];
    mux.subscribe('market://coinbase/book/BTC-USD', (ev) => btcSeen.push(ev.event));
    mux.subscribe('market://coinbase/book/ETH-USD', (ev) => ethSeen.push(ev.event));

    mux.dispatch(undefined, {
      event: 'rebalance',
      reason: 'shutdown',
      deadlineMs: 30000,
    });

    expect(btcSeen).toEqual(['rebalance']);
    expect(ethSeen).toEqual(['rebalance']);
  });

  it('removing a single listener while another stays does not send unsubscribe', () => {
    const send = vi.fn();
    const mux = createSubscriptionMux(send);

    const fnA = vi.fn();
    const fnB = vi.fn();
    const offA = mux.subscribe('market://coinbase/book/BTC-USD', fnA);
    mux.subscribe('market://coinbase/book/BTC-USD', fnB);
    send.mockClear();

    offA();
    expect(send).not.toHaveBeenCalled();

    mux.dispatch('market://coinbase/book/BTC-USD', {
      event: 'stale', resource: 'market://coinbase/book/BTC-USD', reason: 'sequence_gap',
    });
    expect(fnA).not.toHaveBeenCalled();
    expect(fnB).toHaveBeenCalledTimes(1);
  });
});

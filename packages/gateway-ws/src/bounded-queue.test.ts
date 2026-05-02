import { describe, expect, it } from 'vitest';
import { BoundedQueue } from './bounded-queue.js';

describe('BoundedQueue', () => {
  it('enqueues and dequeues in FIFO order', () => {
    const q = new BoundedQueue<number>(3);
    q.enqueue(1);
    q.enqueue(2);
    q.enqueue(3);
    expect(q.dequeue()).toBe(1);
    expect(q.dequeue()).toBe(2);
    expect(q.dequeue()).toBe(3);
    expect(q.dequeue()).toBeUndefined();
  });

  it('drops oldest on overflow', () => {
    const q = new BoundedQueue<number>(3);
    expect(q.enqueue(1).dropped).toBe(false);
    expect(q.enqueue(2).dropped).toBe(false);
    expect(q.enqueue(3).dropped).toBe(false);
    expect(q.enqueue(4).dropped).toBe(true); // dropped 1
    expect(q.enqueue(5).dropped).toBe(true); // dropped 2

    expect(q.dequeue()).toBe(3);
    expect(q.dequeue()).toBe(4);
    expect(q.dequeue()).toBe(5);
    expect(q.totalDropped()).toBe(2);
  });

  it('dropsSinceLastTake resets on read', () => {
    const q = new BoundedQueue<number>(2);
    q.enqueue(1);
    q.enqueue(2);
    q.enqueue(3); // drop 1
    q.enqueue(4); // drop 2
    expect(q.dropsSinceLastTake()).toBe(2);
    expect(q.dropsSinceLastTake()).toBe(0);
    q.enqueue(5); // drop 3
    expect(q.dropsSinceLastTake()).toBe(1);
  });

  it('drainTo: returning false leaves the inspected item in the queue (for retry)', () => {
    // This is the backpressure-friendly semantic: when the handler returns
    // false (e.g. socket bufferedAmount > watermark), the item is NOT consumed
    // so the next flush call can retry it.
    const q = new BoundedQueue<number>(5);
    q.enqueue(1);
    q.enqueue(2);
    q.enqueue(3);
    const inspected: number[] = [];
    const count = q.drainTo((n) => {
      inspected.push(n);
      return n < 2; // continue while n<2; stop at n=2 without consuming it
    });
    expect(count).toBe(1); // only n=1 was consumed
    expect(inspected).toEqual([1, 2]); // handler saw both
    expect(q.length()).toBe(2); // 2 and 3 remain
    expect(q.dequeue()).toBe(2); // 2 is still at the front
  });

  it('survives wrap-around correctly', () => {
    const q = new BoundedQueue<number>(3);
    for (let i = 0; i < 100; i++) {
      q.enqueue(i);
      if (i % 2 === 1) q.dequeue();
    }
    // Should have a sane state; no exception.
    expect(q.length()).toBeLessThanOrEqual(3);
  });

  it('rejects non-positive capacity', () => {
    expect(() => new BoundedQueue<number>(0)).toThrow();
    expect(() => new BoundedQueue<number>(-1)).toThrow();
  });

  it('isFull / isEmpty match length', () => {
    const q = new BoundedQueue<number>(2);
    expect(q.isEmpty()).toBe(true);
    q.enqueue(1);
    expect(q.isEmpty()).toBe(false);
    q.enqueue(2);
    expect(q.isFull()).toBe(true);
  });
});

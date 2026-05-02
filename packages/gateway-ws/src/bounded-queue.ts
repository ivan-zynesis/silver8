/**
 * Fixed-capacity ring buffer with drop-oldest overflow semantics (DEC-011).
 *
 * - `enqueue()` always succeeds; if the buffer is full, the oldest entry is
 *   evicted to make room. The number of evicted entries is tracked so callers
 *   can surface `lagged` notifications to consumers.
 * - `drainTo(handler)` walks the queue front-to-back, invoking the handler.
 *   If the handler returns a falsy value the drain pauses (e.g. when
 *   `socket.bufferedAmount` indicates back-pressure on the wire).
 * - `dropsSinceLastTake()` returns the count of evictions that happened since
 *   the last call (useful for emitting a single `lagged` event with the
 *   accumulated count, rather than spamming one per drop).
 */
export class BoundedQueue<T> {
  private readonly buf: (T | undefined)[];
  private head = 0;
  private tail = 0;
  private size = 0;
  private dropped = 0;
  private droppedSinceTake = 0;

  constructor(public readonly capacity: number) {
    if (capacity <= 0) throw new Error('BoundedQueue capacity must be positive');
    this.buf = new Array<T | undefined>(capacity);
  }

  enqueue(item: T): { dropped: boolean } {
    let didDrop = false;
    if (this.size === this.capacity) {
      // Drop the oldest by advancing head; tail will overwrite at its slot.
      this.buf[this.head] = undefined;
      this.head = (this.head + 1) % this.capacity;
      this.size -= 1;
      this.dropped += 1;
      this.droppedSinceTake += 1;
      didDrop = true;
    }
    this.buf[this.tail] = item;
    this.tail = (this.tail + 1) % this.capacity;
    this.size += 1;
    return { dropped: didDrop };
  }

  dequeue(): T | undefined {
    if (this.size === 0) return undefined;
    const item = this.buf[this.head];
    this.buf[this.head] = undefined;
    this.head = (this.head + 1) % this.capacity;
    this.size -= 1;
    return item;
  }

  /**
   * Drain entries to a handler until the handler returns false or the queue is
   * empty. Returns the number of entries successfully delivered.
   */
  drainTo(handler: (item: T) => boolean | void): number {
    let delivered = 0;
    while (this.size > 0) {
      const peek = this.buf[this.head]!;
      const cont = handler(peek);
      if (cont === false) break;
      this.buf[this.head] = undefined;
      this.head = (this.head + 1) % this.capacity;
      this.size -= 1;
      delivered += 1;
    }
    return delivered;
  }

  length(): number {
    return this.size;
  }

  isFull(): boolean {
    return this.size === this.capacity;
  }

  isEmpty(): boolean {
    return this.size === 0;
  }

  totalDropped(): number {
    return this.dropped;
  }

  /**
   * Returns the count of drops since the last call to this method, then resets.
   * Used by the gateway to emit a single `lagged` event with cumulative count.
   */
  dropsSinceLastTake(): number {
    const n = this.droppedSinceTake;
    this.droppedSinceTake = 0;
    return n;
  }
}

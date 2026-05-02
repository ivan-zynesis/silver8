import type {
  Bus,
  BusDemandChange,
  BusHandler,
  BusMessage,
  DemandChangeHandler,
  ResourceURI,
  Unsubscribe,
} from '@silver8/core';

/**
 * In-memory Bus that honors the same semantics as a distributed bus (DEC-005).
 *
 * IMPORTANT: this is not a synchronous EventEmitter wrapper. It deliberately:
 *  - returns a Promise from publish() that resolves after dispatch is queued
 *  - delivers to subscribers on the next microtask, not inline
 *  - swallows subscriber errors (the publisher MUST NOT see subscriber faults)
 *  - drops messages for late subscribers (no replay)
 *  - serializes per-topic FIFO; gives no cross-topic ordering guarantee
 *  - emits onDemandChange when a topic transitions 0↔1 subscribers
 *
 * These semantics make `InMemoryBus` swap-equivalent with NATS / Redis pub-sub.
 */
export class InMemoryBus implements Bus {
  private readonly subs = new Map<ResourceURI, Set<BusHandler>>();
  private readonly demandHandlers = new Set<DemandChangeHandler>();

  publish(topic: ResourceURI, msg: BusMessage): Promise<void> {
    const handlers = this.subs.get(topic);
    if (!handlers || handlers.size === 0) {
      // Lossy: no subscribers means the message is dropped.
      return Promise.resolve();
    }
    // Snapshot the handler set so concurrent unsubscribes during dispatch don't
    // mutate iteration. Microtask-queue the dispatch so subscribers don't run
    // inline on the publisher's stack.
    const snapshot = Array.from(handlers);
    return Promise.resolve().then(() => {
      for (const handler of snapshot) {
        try {
          handler(msg);
        } catch {
          // Subscriber errors do not propagate to the publisher. In production we'd
          // increment a metric here; the logger is intentionally not injected to
          // keep core-memory dependency-free from observability.
        }
      }
    });
  }

  subscribe(topic: ResourceURI, handler: BusHandler): Unsubscribe {
    let set = this.subs.get(topic);
    const isFirst = !set || set.size === 0;
    if (!set) {
      set = new Set();
      this.subs.set(topic, set);
    }
    set.add(handler);

    if (isFirst) {
      this.emitDemand({ topic, count: 1, delta: 1 });
    }

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const current = this.subs.get(topic);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) {
        this.subs.delete(topic);
        this.emitDemand({ topic, count: 0, delta: -1 });
      }
    };
  }

  onDemandChange(cb: DemandChangeHandler): Unsubscribe {
    this.demandHandlers.add(cb);
    return () => {
      this.demandHandlers.delete(cb);
    };
  }

  activeTopics(): readonly ResourceURI[] {
    return Array.from(this.subs.keys());
  }

  demandFor(topic: ResourceURI): number {
    return this.subs.get(topic)?.size ?? 0;
  }

  private emitDemand(change: BusDemandChange): void {
    // Demand handlers fire synchronously; they're internal subscribers (the
    // ingestion tier driving upstream subs), not external lossy consumers.
    for (const cb of this.demandHandlers) {
      try {
        cb(change);
      } catch {
        // ignore — demand handlers must not poison each other
      }
    }
  }
}

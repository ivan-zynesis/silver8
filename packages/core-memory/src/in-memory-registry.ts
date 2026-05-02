import type {
  ConsumerHandle,
  Registry,
  RegistryDemandChange,
  RegistryStatus,
  RegistryStatusByTopic,
  ResourceURI,
  Unsubscribe,
} from '@silver8/core';

/**
 * In-memory Registry. Holds consumer handles (with their live socket references —
 * the only practical primitive per DEC-006) and bidirectional indices between
 * consumers and topics for refcounted demand.
 *
 * Memory-safety invariants enforced by construction:
 *   - removeConsumer() unsubscribes from every topic, so no orphan entries can
 *     linger in `topicConsumers` after the consumer is gone.
 *   - subscribe / unsubscribe maintain `topicConsumers` and `consumerSubs` in
 *     lockstep; both indices share the same authoritative truth.
 *   - onDemandChange returns an Unsubscribe; we never accumulate demand handlers
 *     silently.
 */
export class InMemoryRegistry implements Registry {
  private readonly consumers = new Map<string, ConsumerHandle>();
  private readonly topicConsumers = new Map<ResourceURI, Set<string>>();
  private readonly consumerSubs = new Map<string, Set<ResourceURI>>();
  private readonly demandHandlers = new Set<(c: RegistryDemandChange) => void>();

  registerConsumer(handle: ConsumerHandle): void {
    if (this.consumers.has(handle.id)) {
      // Idempotent re-register would mask a bug elsewhere; treat as programming error.
      throw new Error(`consumer ${handle.id} already registered`);
    }
    this.consumers.set(handle.id, handle);
    this.consumerSubs.set(handle.id, new Set());
  }

  removeConsumer(id: string): void {
    const consumer = this.consumers.get(id);
    if (!consumer) return; // idempotent

    // Single cleanup path: unsubscribeAll + delete from primary index.
    this.unsubscribeAll(id);
    this.consumers.delete(id);
    this.consumerSubs.delete(id);
  }

  subscribe(consumerId: string, uri: ResourceURI): void {
    const subs = this.consumerSubs.get(consumerId);
    if (!subs) {
      throw new Error(`subscribe failed: unknown consumer ${consumerId}`);
    }
    if (subs.has(uri)) return; // idempotent

    subs.add(uri);

    let topicSet = this.topicConsumers.get(uri);
    const wasZero = !topicSet || topicSet.size === 0;
    if (!topicSet) {
      topicSet = new Set();
      this.topicConsumers.set(uri, topicSet);
    }
    topicSet.add(consumerId);

    if (wasZero) {
      this.emitDemand({ topic: uri, count: 1, delta: 1 });
    }
  }

  unsubscribe(consumerId: string, uri: ResourceURI): void {
    const subs = this.consumerSubs.get(consumerId);
    if (!subs || !subs.has(uri)) return; // idempotent

    subs.delete(uri);

    const topicSet = this.topicConsumers.get(uri);
    if (!topicSet) return;
    topicSet.delete(consumerId);
    if (topicSet.size === 0) {
      this.topicConsumers.delete(uri);
      this.emitDemand({ topic: uri, count: 0, delta: -1 });
    }
  }

  unsubscribeAll(consumerId: string): void {
    const subs = this.consumerSubs.get(consumerId);
    if (!subs) return;
    // Iterate a snapshot since unsubscribe mutates `subs`.
    for (const uri of Array.from(subs)) {
      this.unsubscribe(consumerId, uri);
    }
  }

  consumersFor(uri: ResourceURI): readonly ConsumerHandle[] {
    const ids = this.topicConsumers.get(uri);
    if (!ids) return [];
    const out: ConsumerHandle[] = [];
    for (const id of ids) {
      const c = this.consumers.get(id);
      if (c) out.push(c);
    }
    return out;
  }

  subscriptionsFor(consumerId: string): readonly ResourceURI[] {
    const subs = this.consumerSubs.get(consumerId);
    return subs ? Array.from(subs) : [];
  }

  demandFor(uri: ResourceURI): number {
    return this.topicConsumers.get(uri)?.size ?? 0;
  }

  activeTopics(): readonly ResourceURI[] {
    return Array.from(this.topicConsumers.keys());
  }

  onDemandChange(cb: (change: RegistryDemandChange) => void): Unsubscribe {
    this.demandHandlers.add(cb);
    return () => {
      this.demandHandlers.delete(cb);
    };
  }

  status(): RegistryStatus {
    let ws = 0;
    let mcp = 0;
    for (const c of this.consumers.values()) {
      if (c.surface === 'ws') ws += 1;
      else if (c.surface === 'mcp') mcp += 1;
    }
    let totalSubs = 0;
    const byTopic: RegistryStatusByTopic[] = [];
    for (const [topic, ids] of this.topicConsumers) {
      totalSubs += ids.size;
      byTopic.push({ topic, consumerCount: ids.size });
    }
    byTopic.sort((a, b) => b.consumerCount - a.consumerCount);
    return {
      consumersBySurface: { ws, mcp },
      totalSubscriptions: totalSubs,
      byTopic,
    };
  }

  private emitDemand(change: RegistryDemandChange): void {
    for (const cb of this.demandHandlers) {
      try {
        cb(change);
      } catch {
        // demand handlers must not poison each other
      }
    }
  }
}

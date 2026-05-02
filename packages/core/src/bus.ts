import type { BusMessage } from './messages.js';
import type { ResourceURI } from './uri.js';

export type BusHandler = (msg: BusMessage) => void;
export type Unsubscribe = () => void;

/**
 * The Bus is the fanout primitive between ingestion and gateway/MCP tiers.
 *
 * Semantics (DEC-005) — these MUST hold for every implementation, in-memory or distributed:
 *  - Async publish: returns Promise that resolves after dispatch is queued. Never propagates
 *    subscriber errors back to the publisher.
 *  - Microtask-queued delivery: subscribers fire on the next microtask, not inline on the
 *    publisher's stack.
 *  - Lossy: no durability, no replay. A subscriber that registers after a publish does not
 *    see the prior message. Consumer-level backpressure (DEC-011) handles slow subscribers.
 *  - No cross-topic ordering: only FIFO within a single topic.
 *  - Demand observable: onDemandChange notifies when a topic gains its first subscriber or
 *    loses its last subscriber. Drives upstream subscribe/unsubscribe in the ingestion tier.
 */
export interface Bus {
  publish(topic: ResourceURI, msg: BusMessage): Promise<void>;
  subscribe(topic: ResourceURI, handler: BusHandler): Unsubscribe;

  /** Notified when a topic transitions between 0 and >0 subscribers. */
  onDemandChange(cb: DemandChangeHandler): Unsubscribe;

  /** All topics that currently have at least one subscriber. */
  activeTopics(): readonly ResourceURI[];
  /** Subscriber count for a single topic. */
  demandFor(topic: ResourceURI): number;
}

export type DemandChangeHandler = (change: BusDemandChange) => void;

export interface BusDemandChange {
  topic: ResourceURI;
  count: number;
  /** +1 when a topic gained a subscriber; -1 when it lost one. */
  delta: 1 | -1;
}

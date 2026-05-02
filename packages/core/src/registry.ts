import type { BusMessage } from './messages.js';
import type { ResourceURI } from './uri.js';
import type { Unsubscribe } from './bus.js';

export type ConsumerSurface = 'ws' | 'mcp';

export interface ConsumerHandle {
  readonly id: string;
  readonly surface: ConsumerSurface;
  /** Used during connection accounting; e.g. for /status reporting. */
  readonly remoteAddr?: string;
  /** ISO-8601 timestamp captured at registerConsumer() time. */
  readonly connectedAt: string;

  /**
   * Deliver a bus message to this consumer. Implementations enforce per-consumer
   * backpressure (DEC-011): bounded ring buffer, drop-oldest, sustained-overflow
   * disconnect. Returns the queue health so the registry can surface lag metrics.
   */
  deliver(msg: BusMessage): SendResult;

  /** Send a server-initiated event (rebalance hint, error, lagged notice). */
  sendEvent(event: ConsumerEvent): void;

  /** Close the underlying socket cleanly with a reason. */
  disconnect(reason: string): void;
}

export type SendResult =
  | { status: 'queued' }
  | { status: 'dropped'; queueDepth: number };

export type ConsumerEvent =
  | { type: 'lagged'; uri: ResourceURI; dropped: number }
  | { type: 'stale'; uri: ResourceURI; reason: string }
  | { type: 'fresh'; uri: ResourceURI }
  | { type: 'rebalance'; reason: string; deadlineMs: number }
  | { type: 'error'; code: string; message: string };

export interface RegistryStatusByTopic {
  topic: ResourceURI;
  consumerCount: number;
}

export interface RegistryStatus {
  consumersBySurface: Record<ConsumerSurface, number>;
  totalSubscriptions: number;
  byTopic: RegistryStatusByTopic[];
}

export interface RegistryDemandChange {
  topic: ResourceURI;
  count: number;
  delta: 1 | -1;
}

/**
 * Registry tracks consumer connections and their subscriptions, with refcount-driven
 * demand events used by the ingestion tier to gate upstream subscriptions.
 *
 * Hazards (DEC-006) addressed by implementation discipline:
 *   1. Single cleanup path: removeConsumer/unsubscribeAll cover every disconnect.
 *   2. No orphan entries: subscribe/unsubscribe maintain bidirectional indices in lockstep.
 *   3. Listener leaks: handlers passed to onDemandChange are tracked with explicit
 *      Unsubscribe returns; no hidden state.
 */
export interface Registry {
  registerConsumer(handle: ConsumerHandle): void;
  /** Idempotent. Removes consumer from every index and unsubscribes all topics. */
  removeConsumer(id: string): void;

  subscribe(consumerId: string, uri: ResourceURI): void;
  unsubscribe(consumerId: string, uri: ResourceURI): void;
  unsubscribeAll(consumerId: string): void;

  consumersFor(uri: ResourceURI): readonly ConsumerHandle[];
  subscriptionsFor(consumerId: string): readonly ResourceURI[];
  demandFor(uri: ResourceURI): number;
  activeTopics(): readonly ResourceURI[];

  onDemandChange(cb: (change: RegistryDemandChange) => void): Unsubscribe;

  /** Snapshot for /status and MCP get_hub_status (DEC-022). */
  status(): RegistryStatus;
}

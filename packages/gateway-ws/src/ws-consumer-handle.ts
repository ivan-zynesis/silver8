import type { WebSocket } from 'ws';
import type {
  BusMessage,
  ConsumerEvent,
  ConsumerHandle,
  ConsumerSurface,
  SendResult,
} from '@silver8/core';
import {
  consumerDrops,
  consumerLaggedDisconnects,
  type Logger,
} from '@silver8/observability';
import { BoundedQueue } from './bounded-queue.js';
import {
  serializeEvent,
  type LaggedEvent,
  type ServerEvent,
  type SnapshotEvent,
  type UpdateEvent,
} from './protocol.js';

export interface WsConsumerHandleOptions {
  id: string;
  socket: WebSocket;
  remoteAddr?: string;
  queueDepth: number;
  bufferedWatermarkBytes: number;
  /** Sustained-overflow window (ms) before disconnect. */
  overflowDisconnectMs: number;
  logger: Logger;
  /** Hook so the gateway can reap us out of the registry on disconnect. */
  onClose: (id: string, reason: string) => void;
}

/**
 * Bridges a single ws.WebSocket to the registry/bus contract.
 *
 * Backpressure (DEC-011):
 *  - Bounded queue per consumer; on overflow, drop oldest, accumulate drop count.
 *  - On every `flush()` (called from gateway on each Bus message or on socket
 *    drain), check `socket.bufferedAmount` against watermark. If over watermark,
 *    arm a "sustained overflow" timer; if not cleared within
 *    overflowDisconnectMs, emit `lagged` event then disconnect.
 */
export class WsConsumerHandle implements ConsumerHandle {
  readonly id: string;
  readonly surface: ConsumerSurface = 'ws';
  readonly remoteAddr: string | undefined;
  readonly connectedAt: string;

  private readonly socket: WebSocket;
  private readonly queue: BoundedQueue<BusMessage>;
  private readonly opts: WsConsumerHandleOptions;
  private overflowSince: number | null = null;
  private overflowTimer: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(opts: WsConsumerHandleOptions) {
    this.id = opts.id;
    this.remoteAddr = opts.remoteAddr;
    this.connectedAt = new Date().toISOString();
    this.socket = opts.socket;
    this.queue = new BoundedQueue(opts.queueDepth);
    this.opts = opts;

    this.socket.on('close', (code, reason) => {
      if (this.closed) return;
      this.closed = true;
      this.clearOverflow();
      this.opts.onClose(this.id, reason.toString() || `code ${code}`);
    });
    this.socket.on('error', (err) => {
      this.opts.logger.error({ id: this.id, err: { message: err.message } }, 'ws error');
    });
  }

  deliver(msg: BusMessage): SendResult {
    if (this.closed) return { status: 'dropped', queueDepth: 0 };
    const { dropped } = this.queue.enqueue(msg);
    if (dropped) {
      consumerDrops.inc({ surface: this.surface, reason: 'queue_overflow' });
    }
    this.flush();
    return dropped
      ? { status: 'dropped', queueDepth: this.queue.length() }
      : { status: 'queued' };
  }

  sendEvent(event: ConsumerEvent): void {
    if (this.closed) return;
    const wire = mapConsumerEventToWire(event);
    if (wire) this.sendWire(wire);
  }

  disconnect(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.socket.close(1000, reason);
    } catch {
      // ignore
    }
    this.clearOverflow();
  }

  /**
   * Drain the queue to the socket. Stops on backpressure (bufferedAmount over
   * watermark) and arms the sustained-overflow timer.
   */
  flush(): void {
    if (this.closed) return;
    if (this.socket.readyState !== this.socket.OPEN) return;

    this.queue.drainTo((msg) => {
      if (this.socket.bufferedAmount > this.opts.bufferedWatermarkBytes) {
        this.armOverflow();
        return false; // stop drain; socket is back-pressured
      }
      const wire = mapBusMessageToWire(msg);
      if (wire) this.sendWire(wire);
      return true;
    });

    // If we drained without hitting watermark, all clear.
    if (this.socket.bufferedAmount <= this.opts.bufferedWatermarkBytes) {
      this.clearOverflow();
    }

    // Emit a single 'lagged' event with the accumulated drop count, if any.
    const dropped = this.queue.dropsSinceLastTake();
    if (dropped > 0) {
      // We don't have a single "resource" for a per-consumer drop; pick the
      // most recent message's URI if available, else aggregate notification.
      this.sendWire({ event: 'lagged', resource: '*', dropped });
    }
  }

  isClosed(): boolean {
    return this.closed;
  }

  private armOverflow(): void {
    if (this.overflowSince === null) {
      this.overflowSince = Date.now();
      this.overflowTimer = setTimeout(() => {
        this.opts.logger.warn(
          { id: this.id, ms: this.opts.overflowDisconnectMs },
          'consumer sustained overflow; disconnecting',
        );
        consumerLaggedDisconnects.inc({ surface: this.surface });
        this.disconnect('consumer_lagged');
      }, this.opts.overflowDisconnectMs);
    }
  }

  private clearOverflow(): void {
    if (this.overflowTimer) {
      clearTimeout(this.overflowTimer);
      this.overflowTimer = null;
    }
    this.overflowSince = null;
  }

  private sendWire(event: ServerEvent): void {
    if (this.closed) return;
    if (this.socket.readyState !== this.socket.OPEN) return;
    try {
      this.socket.send(serializeEvent(event));
    } catch (err) {
      this.opts.logger.error({ err, id: this.id }, 'failed to send wire event');
    }
  }
}

function mapBusMessageToWire(msg: BusMessage): ServerEvent | null {
  switch (msg.kind) {
    case 'book.snapshot': {
      const event: SnapshotEvent = {
        event: 'snapshot',
        resource: msg.uri,
        data: msg.view,
        sequence: msg.view.sequence,
        stale: msg.view.stale,
      };
      return event;
    }
    case 'book.update': {
      const event: UpdateEvent = {
        event: 'update',
        resource: msg.uri,
        data: msg.view,
        sequence: msg.view.sequence,
      };
      return event;
    }
    case 'book.stale':
      return { event: 'stale', resource: msg.uri, reason: msg.reason };
    case 'book.fresh':
      return { event: 'fresh', resource: msg.uri };
  }
}

function mapConsumerEventToWire(ev: ConsumerEvent): ServerEvent | null {
  switch (ev.type) {
    case 'lagged': {
      const out: LaggedEvent = { event: 'lagged', resource: ev.uri, dropped: ev.dropped };
      return out;
    }
    case 'stale':
      return { event: 'stale', resource: ev.uri, reason: ev.reason };
    case 'fresh':
      return { event: 'fresh', resource: ev.uri };
    case 'rebalance':
      return { event: 'rebalance', reason: ev.reason, deadlineMs: ev.deadlineMs };
    case 'error':
      return { event: 'error', code: ev.code, message: ev.message };
  }
}

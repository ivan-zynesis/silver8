import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { WebSocketServer, type WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import {
  BUS,
  DRAIN_REGISTRAR,
  LOGGER,
  ORDER_BOOK_STORE,
  READINESS_REPORTER,
  REGISTRY,
  UnknownTopicError,
  VENUE_ADAPTER_CATALOG,
  parseResourceUri,
  type Bus,
  type BusMessage,
  type DrainableRegistrar,
  type OrderBookStore,
  type ReadinessReporter,
  type Registry,
  type ResourceURI,
  type Unsubscribe,
  type VenueAdapterCatalog,
} from '@silver8/core';
import {
  activeConsumerConnections,
  activeSubscriptions,
  type Logger,
} from '@silver8/observability';
import { WsConsumerHandle } from './ws-consumer-handle.js';
import {
  parseClientOp,
  serializeEvent,
  type ClientOp,
  type ServerEvent,
} from './protocol.js';
import { GATEWAY_WS_CONFIG, type GatewayWsConfig } from './config.js';
import type { Drainable } from './drainable.js';

const READINESS_KEY = 'gateway-ws';

interface ConsumerEntry {
  handle: WsConsumerHandle;
  busSubs: Map<ResourceURI, Unsubscribe>;
}

/**
 * Owns the WebSocket server and the consumer fan-out path.
 * Implements Drainable so the hub can broadcast a rebalance hint on SIGTERM
 * before force-closing remaining sockets (DEC-019).
 */
@Injectable()
export class WsGatewayService
  implements OnApplicationBootstrap, OnModuleDestroy, Drainable
{
  readonly drainName = 'gateway-ws';
  private wss: WebSocketServer | null = null;
  private readonly consumers = new Map<string, ConsumerEntry>();
  private accepting = true;

  constructor(
    @Inject(GATEWAY_WS_CONFIG) private readonly config: GatewayWsConfig,
    @Inject(BUS) private readonly bus: Bus,
    @Inject(REGISTRY) private readonly registry: Registry,
    @Inject(ORDER_BOOK_STORE) private readonly store: OrderBookStore,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(READINESS_REPORTER) private readonly readiness: ReadinessReporter,
    @Inject(DRAIN_REGISTRAR) private readonly drainRegistrar: DrainableRegistrar,
    @Inject(VENUE_ADAPTER_CATALOG) private readonly catalog: VenueAdapterCatalog,
  ) {}

  onApplicationBootstrap(): void {
    this.readiness.declare(READINESS_KEY);
    this.drainRegistrar.register(this);
    this.wss = new WebSocketServer({ port: this.config.port });
    this.wss.on('listening', () => {
      this.logger.info({ port: this.config.port }, 'ws gateway listening');
      this.readiness.set(READINESS_KEY, true);
    });
    this.wss.on('connection', (socket, req) => this.acceptConnection(socket, req.socket.remoteAddress));
    this.wss.on('error', (err) => {
      this.logger.error({ err: { message: err.message } }, 'ws server error');
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.readiness.set(READINESS_KEY, false);
    await this.shutdownServer();
  }

  // === Drainable ===

  async drain(deadlineMs: number): Promise<void> {
    this.accepting = false;
    this.readiness.set(READINESS_KEY, false);
    const reason = 'shutdown';

    // Broadcast rebalance to every connected consumer.
    for (const entry of this.consumers.values()) {
      entry.handle.sendEvent({ type: 'rebalance', reason, deadlineMs });
    }

    // Wait until either everyone disconnected on their own or the deadline expires.
    const start = Date.now();
    while (this.consumers.size > 0 && Date.now() - start < deadlineMs) {
      await new Promise((r) => setTimeout(r, 100));
    }

    // Force-close any stragglers.
    if (this.consumers.size > 0) {
      this.logger.warn(
        { remaining: this.consumers.size },
        'drain deadline reached; force-closing',
      );
      for (const entry of this.consumers.values()) {
        entry.handle.disconnect('drain_timeout');
      }
    }

    await this.shutdownServer();
  }

  // === Connection handling ===

  private acceptConnection(socket: WebSocket, remoteAddr?: string): void {
    if (!this.accepting) {
      socket.close(1013, 'not_accepting');
      return;
    }
    const id = randomUUID();
    const handle = new WsConsumerHandle({
      id,
      socket,
      remoteAddr: remoteAddr ?? undefined,
      queueDepth: this.config.queueDepth,
      bufferedWatermarkBytes: this.config.bufferedWatermarkBytes,
      overflowDisconnectMs: this.config.overflowDisconnectMs,
      logger: this.logger,
      onClose: (cid, reason) => this.removeConsumer(cid, reason),
    });

    const entry: ConsumerEntry = { handle, busSubs: new Map() };
    this.consumers.set(id, entry);
    this.registry.registerConsumer(handle);
    activeConsumerConnections.inc({ surface: 'ws' });

    socket.on('message', (data) => {
      this.handleClientMessage(entry, data.toString('utf8'));
    });

    this.logger.info({ id, remoteAddr }, 'ws consumer connected');
  }

  private removeConsumer(id: string, reason: string): void {
    const entry = this.consumers.get(id);
    if (!entry) return;
    for (const off of entry.busSubs.values()) off();
    entry.busSubs.clear();
    this.registry.removeConsumer(id);
    this.consumers.delete(id);
    activeConsumerConnections.dec({ surface: 'ws' });
    activeSubscriptions.set(this.totalSubscriptions());
    this.logger.info({ id, reason }, 'ws consumer disconnected');
  }

  private handleClientMessage(entry: ConsumerEntry, raw: string): void {
    const result = parseClientOp(raw);
    if (!result.ok) {
      this.sendDirect(entry.handle, {
        event: 'error',
        code: 'protocol_error',
        message: result.error,
      });
      return;
    }
    const op = result.value;
    switch (op.op) {
      case 'subscribe':
        this.handleSubscribe(entry, op);
        break;
      case 'unsubscribe':
        this.handleUnsubscribe(entry, op);
        break;
      case 'ping':
        this.sendDirect(entry.handle, { event: 'pong', ...(op.id ? { id: op.id } : {}) });
        break;
    }
  }

  private handleSubscribe(entry: ConsumerEntry, op: Extract<ClientOp, { op: 'subscribe' }>): void {
    const uri = op.resource as ResourceURI;
    try {
      parseResourceUri(uri);
    } catch (err) {
      this.sendDirect(entry.handle, {
        event: 'error',
        code: 'invalid_uri',
        message: (err as Error).message,
        ...(op.id ? { id: op.id } : {}),
      });
      return;
    }

    // Catalog enforcement (DEC-030). The catalog is authoritative — well-formed
    // URIs that aren't in the catalog are rejected with an enumerated helpful
    // error rather than silently accepted.
    if (!this.catalog.describeCatalogEntry(uri)) {
      const available = this.catalog.listCatalog().map((t) => t.uri);
      const err = new UnknownTopicError(uri, available);
      this.sendDirect(entry.handle, {
        event: 'error',
        code: err.code,
        message: err.message,
        ...(op.id ? { id: op.id } : {}),
      });
      return;
    }

    if (entry.busSubs.has(uri)) {
      // Idempotent — ack but don't double-subscribe.
      this.sendDirect(entry.handle, {
        event: 'ack', op: 'subscribe', resource: uri, ...(op.id ? { id: op.id } : {}),
      });
      return;
    }

    this.registry.subscribe(entry.handle.id, uri);
    activeSubscriptions.set(this.totalSubscriptions());

    const off = this.bus.subscribe(uri, (msg: BusMessage) => {
      entry.handle.deliver(msg);
    });
    entry.busSubs.set(uri, off);

    this.sendDirect(entry.handle, {
      event: 'ack', op: 'subscribe', resource: uri, ...(op.id ? { id: op.id } : {}),
    });

    // Bring the new subscriber up-to-date with the current view if available.
    const view = this.store.getView(uri, 50);
    if (view) {
      this.sendDirect(entry.handle, {
        event: 'snapshot',
        resource: uri,
        data: view,
        sequence: view.sequence,
        stale: view.stale,
      });
    }
  }

  private handleUnsubscribe(entry: ConsumerEntry, op: Extract<ClientOp, { op: 'unsubscribe' }>): void {
    const uri = op.resource as ResourceURI;
    const off = entry.busSubs.get(uri);
    if (off) {
      off();
      entry.busSubs.delete(uri);
    }
    this.registry.unsubscribe(entry.handle.id, uri);
    activeSubscriptions.set(this.totalSubscriptions());
    this.sendDirect(entry.handle, {
      event: 'ack', op: 'unsubscribe', resource: uri, ...(op.id ? { id: op.id } : {}),
    });
  }

  private sendDirect(handle: WsConsumerHandle, event: ServerEvent): void {
    // Direct send used for control responses (ack, error, pong) — these are
    // not subject to per-consumer queue backpressure because they're response
    // to the client's own message and small.
    if (handle.isClosed()) return;
    try {
      handle['socket'].send(serializeEvent(event));
    } catch {
      // ignore; socket likely going down
    }
  }

  private totalSubscriptions(): number {
    let n = 0;
    for (const e of this.consumers.values()) n += e.busSubs.size;
    return n;
  }

  private async shutdownServer(): Promise<void> {
    if (!this.wss) return;
    const wss = this.wss;
    this.wss = null;
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  }

  // === Diagnostics ===

  status() {
    return {
      port: this.config.port,
      consumers: this.consumers.size,
      subscriptions: this.totalSubscriptions(),
      accepting: this.accepting,
    };
  }
}

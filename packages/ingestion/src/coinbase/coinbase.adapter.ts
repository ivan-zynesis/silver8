import { Inject, Injectable } from '@nestjs/common';
import { WebSocket } from 'ws';
import { LOGGER, buildResourceUri, type ResourceURI } from '@silver8/core';
import {
  upstreamConnectionStatus,
  upstreamLatency,
  type Logger,
} from '@silver8/observability';
import { CoinbaseProtocolHandler, type SequenceGap } from './coinbase.protocol-handler.js';
import type { CoinbaseSubscribeMessage } from './coinbase.types.js';

export interface CoinbaseAdapterConfig {
  url: string;
  symbols: string[];
  /** Watchdog: if no message arrives within this window, force reconnect. */
  heartbeatTimeoutMs: number;
  /** Reconnect backoff bounds. */
  reconnectInitialMs: number;
  reconnectMaxMs: number;
}

export interface AdapterStatus {
  status: 'connected' | 'connecting' | 'disconnected' | 'reconnecting';
  connectedAt?: string;
  symbols: string[];
  lastMessageAt?: string;
  reconnectAttempts: number;
}

export const COINBASE_ADAPTER_CONFIG = Symbol.for('silver8.CoinbaseAdapterConfig');

@Injectable()
export class CoinbaseAdapter {
  private ws: WebSocket | null = null;
  private status: AdapterStatus['status'] = 'disconnected';
  private connectedAt: string | undefined;
  private lastMessageAt: string | undefined;
  private reconnectAttempts = 0;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopRequested = false;
  private resubscribePending = false;

  constructor(
    @Inject(COINBASE_ADAPTER_CONFIG) private readonly config: CoinbaseAdapterConfig,
    private readonly handler: CoinbaseProtocolHandler,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {
    this.handler.setEvents({
      onSequenceGap: (gap) => this.handleSequenceGap(gap),
      onMessage: () => this.markLastMessage(),
    });
    this.handler.setSubscribedTopics(this.config.symbols.map((s) => topicFor(s)));
  }

  start(): void {
    this.stopRequested = false;
    this.connect();
  }

  async stop(): Promise<void> {
    this.stopRequested = true;
    this.clearTimers();
    if (this.ws) {
      try {
        this.unsubscribe(this.config.symbols);
      } catch {
        // best effort
      }
      this.ws.close();
      this.ws = null;
    }
    this.status = 'disconnected';
    upstreamConnectionStatus.set({ venue: 'coinbase' }, 0);
  }

  getStatus(): AdapterStatus {
    return {
      status: this.status,
      ...(this.connectedAt ? { connectedAt: this.connectedAt } : {}),
      symbols: [...this.config.symbols],
      ...(this.lastMessageAt ? { lastMessageAt: this.lastMessageAt } : {}),
      reconnectAttempts: this.reconnectAttempts,
    };
  }

  private connect(): void {
    this.status = this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting';
    upstreamConnectionStatus.set({ venue: 'coinbase' }, 0);

    this.logger.info(
      { url: this.config.url, attempt: this.reconnectAttempts + 1 },
      'connecting to coinbase ws',
    );

    const ws = new WebSocket(this.config.url);
    this.ws = ws;

    ws.on('open', () => {
      this.status = 'connected';
      this.connectedAt = new Date().toISOString();
      this.reconnectAttempts = 0;
      upstreamConnectionStatus.set({ venue: 'coinbase' }, 1);
      this.logger.info({ symbols: this.config.symbols }, 'connected; subscribing');
      this.subscribe(this.config.symbols);
      this.armHeartbeatWatchdog();
    });

    ws.on('message', (data) => {
      this.markLastMessage();
      this.armHeartbeatWatchdog();
      const start = Date.now();
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString('utf8'));
      } catch (err) {
        this.logger.error({ err }, 'failed to parse JSON frame');
        return;
      }
      this.handler.handle(parsed).then(
        () => {
          upstreamLatency.observe({ venue: 'coinbase' }, Date.now() - start);
        },
        (err) => {
          this.logger.error({ err }, 'handler threw');
        },
      );
    });

    ws.on('close', (code, reason) => {
      this.logger.warn({ code, reason: reason.toString() }, 'coinbase ws closed');
      upstreamConnectionStatus.set({ venue: 'coinbase' }, 0);
      this.status = 'disconnected';
      this.clearTimers();
      this.handler.resetSequence();
      this.scheduleReconnect();
    });

    ws.on('error', (err) => {
      this.logger.error({ err: { message: err.message } }, 'coinbase ws error');
      // 'close' will follow; reconnect logic lives there.
    });
  }

  private subscribe(symbols: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.send({
      type: 'subscribe',
      product_ids: symbols,
      channel: 'level2',
    });
    this.send({
      type: 'subscribe',
      product_ids: symbols,
      channel: 'heartbeats',
    });
  }

  private unsubscribe(symbols: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.send({
      type: 'unsubscribe',
      product_ids: symbols,
      channel: 'level2',
    });
    this.send({
      type: 'unsubscribe',
      product_ids: symbols,
      channel: 'heartbeats',
    });
  }

  private send(msg: CoinbaseSubscribeMessage): void {
    this.ws?.send(JSON.stringify(msg));
  }

  private async handleSequenceGap(_gap: SequenceGap): Promise<void> {
    if (this.resubscribePending) return;
    this.resubscribePending = true;
    this.logger.warn('resubscribing to recover from sequence gap');
    try {
      this.unsubscribe(this.config.symbols);
      // Small delay to let unsubscribe ACK before re-sub.
      await new Promise((r) => setTimeout(r, 100));
      this.handler.resetSequence();
      this.subscribe(this.config.symbols);
    } finally {
      this.resubscribePending = false;
    }
  }

  private markLastMessage(): void {
    this.lastMessageAt = new Date().toISOString();
  }

  private armHeartbeatWatchdog(): void {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = setTimeout(() => {
      this.logger.warn(
        { timeoutMs: this.config.heartbeatTimeoutMs },
        'heartbeat watchdog fired; forcing reconnect',
      );
      this.ws?.terminate();
      // 'close' fires next, which schedules reconnect.
    }, this.config.heartbeatTimeoutMs);
  }

  private scheduleReconnect(): void {
    if (this.stopRequested) return;
    this.reconnectAttempts += 1;
    const backoff = Math.min(
      this.config.reconnectMaxMs,
      this.config.reconnectInitialMs * 2 ** Math.min(this.reconnectAttempts - 1, 6),
    );
    this.logger.info({ backoffMs: backoff, attempt: this.reconnectAttempts }, 'scheduling reconnect');
    this.reconnectTimer = setTimeout(() => this.connect(), backoff);
  }

  private clearTimers(): void {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

function topicFor(symbol: string): ResourceURI {
  return buildResourceUri('coinbase', 'book', symbol);
}

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
  /**
   * After the last channel is unsubscribed and zero channels remain, close the
   * upstream socket if it stays idle for this long. `0` disables the idle close
   * entirely (useful for tests / eager mode).
   */
  socketIdleMs: number;
}

export interface AdapterStatus {
  status: 'connected' | 'connecting' | 'disconnected' | 'reconnecting' | 'idle';
  connectedAt?: string;
  /** Configured symbols (the upper bound on what *could* be subscribed). */
  symbols: string[];
  /** Symbols currently subscribed upstream (DEC-027 channel-level demand state). */
  subscribedChannels: string[];
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
  private idleTimer: NodeJS.Timeout | null = null;
  private stopRequested = false;
  private resubscribePending = false;
  /** Symbols whose channels (level2 + heartbeats) we're currently subscribed to upstream. */
  private readonly subscribedChannels = new Set<string>();
  private connectWaiters: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];

  constructor(
    @Inject(COINBASE_ADAPTER_CONFIG) private readonly config: CoinbaseAdapterConfig,
    private readonly handler: CoinbaseProtocolHandler,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {
    this.handler.setEvents({
      onSequenceGap: (gap) => this.handleSequenceGap(gap),
      onMessage: () => this.markLastMessage(),
    });
  }

  /**
   * Begin operating. In demand-driven mode (DEC-027) this is a no-op until the
   * first call to subscribeChannels(); the socket stays closed until demand
   * exists. In eager mode the caller passes preSubscribe=true and we connect
   * + subscribe everything at once.
   */
  start(opts: { preSubscribe?: string[] } = {}): void {
    this.stopRequested = false;
    if (opts.preSubscribe && opts.preSubscribe.length > 0) {
      this.subscribeChannels(opts.preSubscribe);
    } else {
      // demand-driven idle
      this.status = 'idle';
    }
  }

  async stop(): Promise<void> {
    this.stopRequested = true;
    this.clearTimers();
    if (this.ws) {
      try {
        const subs = [...this.subscribedChannels];
        if (subs.length > 0) this.sendUnsubscribe(subs);
      } catch {
        // best effort
      }
      this.ws.close();
      this.ws = null;
    }
    this.subscribedChannels.clear();
    this.status = 'disconnected';
    upstreamConnectionStatus.set({ venue: 'coinbase' }, 0);
    this.rejectConnectWaiters(new Error('adapter stopping'));
  }

  /**
   * Subscribe upstream channels for the given symbols. Idempotent; symbols
   * already subscribed are skipped. If the socket isn't connected, this opens
   * it; the upstream subscribe ops fire on 'open'.
   */
  subscribeChannels(symbols: string[]): void {
    const fresh = symbols.filter((s) => !this.subscribedChannels.has(s));
    for (const s of fresh) this.subscribedChannels.add(s);
    this.handler.setSubscribedTopics(
      [...this.subscribedChannels].map((s) => topicFor(s)),
    );
    if (fresh.length === 0) return;

    this.cancelIdleTimer();
    this.ensureConnecting();
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendSubscribe(fresh);
    }
    // else: 'open' handler subscribes everything in this.subscribedChannels.
  }

  /**
   * Unsubscribe upstream channels for the given symbols. Last-channel
   * unsubscribe arms the socket-idle timer (DEC-027 socket-level grace).
   */
  unsubscribeChannels(symbols: string[]): void {
    const present = symbols.filter((s) => this.subscribedChannels.has(s));
    for (const s of present) this.subscribedChannels.delete(s);
    this.handler.setSubscribedTopics(
      [...this.subscribedChannels].map((s) => topicFor(s)),
    );
    if (present.length === 0) return;

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendUnsubscribe(present);
    }
    if (this.subscribedChannels.size === 0) {
      this.armIdleTimer();
    }
  }

  getStatus(): AdapterStatus {
    return {
      status: this.status,
      ...(this.connectedAt ? { connectedAt: this.connectedAt } : {}),
      symbols: [...this.config.symbols],
      subscribedChannels: [...this.subscribedChannels],
      ...(this.lastMessageAt ? { lastMessageAt: this.lastMessageAt } : {}),
      reconnectAttempts: this.reconnectAttempts,
    };
  }

  /** Convenience for tests / eager-mode callers waiting for the open socket. */
  async waitForConnected(timeoutMs = 5_000): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('connect timeout')), timeoutMs);
      this.connectWaiters.push({
        resolve: () => { clearTimeout(timer); resolve(); },
        reject:  (e) => { clearTimeout(timer); reject(e); },
      });
    });
  }

  private ensureConnecting(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.connect();
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
      const subs = [...this.subscribedChannels];
      this.logger.info({ subscribedChannels: subs }, 'connected; (re)subscribing tracked channels');
      if (subs.length > 0) {
        this.sendSubscribe(subs);
      }
      this.armHeartbeatWatchdog();
      this.resolveConnectWaiters();
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
      this.clearTimers();
      this.handler.resetSequence();
      this.rejectConnectWaiters(new Error(`ws closed before open (code ${code})`));
      // If we still have subscribed channels, reconnect to restore service.
      // Otherwise (idle close, or all channels unsubscribed), park in 'idle'.
      if (this.subscribedChannels.size > 0) {
        this.status = 'disconnected';
        this.scheduleReconnect();
      } else {
        this.status = 'idle';
      }
    });

    ws.on('error', (err) => {
      this.logger.error({ err: { message: err.message } }, 'coinbase ws error');
      // 'close' will follow; reconnect logic lives there.
    });
  }

  private sendSubscribe(symbols: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || symbols.length === 0) return;
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

  private sendUnsubscribe(symbols: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || symbols.length === 0) return;
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
    const symbols = [...this.subscribedChannels];
    if (symbols.length === 0) {
      this.resubscribePending = false;
      return;
    }
    this.logger.warn({ symbols }, 'resubscribing to recover from sequence gap');
    try {
      this.sendUnsubscribe(symbols);
      // Small delay to let unsubscribe ACK before re-sub.
      await new Promise((r) => setTimeout(r, 100));
      this.handler.resetSequence();
      this.sendSubscribe(symbols);
    } finally {
      this.resubscribePending = false;
    }
  }

  private armIdleTimer(): void {
    this.cancelIdleTimer();
    if (this.config.socketIdleMs <= 0) return;  // idle close disabled
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.subscribedChannels.size > 0) return;  // demand returned during the wait
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.logger.info(
          { idleMs: this.config.socketIdleMs },
          'upstream socket idle; closing per DEC-027 socket-level grace',
        );
        try { this.ws.close(1000, 'idle'); } catch { /* ignore */ }
      }
    }, this.config.socketIdleMs);
  }

  private cancelIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private resolveConnectWaiters(): void {
    const waiters = this.connectWaiters.splice(0);
    for (const w of waiters) w.resolve();
  }

  private rejectConnectWaiters(err: Error): void {
    const waiters = this.connectWaiters.splice(0);
    for (const w of waiters) w.reject(err);
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
    // idle timer is *not* cleared here: it intentionally survives across
    // open/close cycles (e.g. an unexpected close while idle should still
    // count down). It IS cleared when channels resubscribe (cancelIdleTimer)
    // or when the adapter stops.
  }
}

function topicFor(symbol: string): ResourceURI {
  return buildResourceUri('coinbase', 'book', symbol);
}

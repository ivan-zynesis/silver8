import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { z } from 'zod';
import { ConnectionReplay, type Channel } from './replay.js';
import type { Envelope } from './fixture.js';

const SubscribeOpSchema = z.object({
  type: z.enum(['subscribe', 'unsubscribe']),
  product_ids: z.array(z.string()).default([]),
  channel: z.enum(['level2', 'heartbeats', 'subscriptions']),
});

export interface MockServerOptions {
  fixture: Envelope[];
  wsPort: number;
  controlPort: number;
  /** Loop the fixture indefinitely. Default true. */
  loop: boolean;
  /**
   * Fixed emission rate in Hz. Default 10 (1 envelope per 100ms per connection).
   * Set to 0 to disable timer-driven emission (use only when tests drive ticks
   * via the control plane).
   */
  rateHz: number;
}

interface ConnectionState {
  socket: WebSocket;
  replay: ConnectionReplay;
  emitTimer: NodeJS.Timeout | null;
  id: string;
}

/**
 * MockServer — replays fixture envelopes to subscribed WS clients, with an
 * adjacent HTTP control plane for fault injection in tests.
 *
 * Each connection has its own ConnectionReplay (cursor + subscription state +
 * sequence counter). This makes the mock safely concurrent for parallel tests.
 */
export class MockServer {
  private wss: WebSocketServer | null = null;
  private control: ReturnType<typeof createServer> | null = null;
  private readonly connections = new Map<string, ConnectionState>();
  private connSeq = 0;

  constructor(private readonly opts: MockServerOptions) {}

  async start(): Promise<void> {
    this.wss = new WebSocketServer({ port: this.opts.wsPort });
    this.wss.on('connection', (socket) => this.acceptWs(socket));
    await new Promise<void>((resolve, reject) => {
      this.wss!.once('listening', resolve);
      this.wss!.once('error', reject);
    });

    this.control = createServer((req, res) => this.handleControl(req, res));
    await new Promise<void>((resolve, reject) => {
      this.control!.listen(this.opts.controlPort, () => resolve());
      this.control!.once('error', reject);
    });
  }

  async stop(): Promise<void> {
    for (const conn of this.connections.values()) {
      if (conn.emitTimer) clearInterval(conn.emitTimer);
      try { conn.socket.close(); } catch { /* ignore */ }
    }
    this.connections.clear();

    if (this.wss) {
      await new Promise<void>((resolve) => this.wss!.close(() => resolve()));
      this.wss = null;
    }
    if (this.control) {
      await new Promise<void>((resolve) => this.control!.close(() => resolve()));
      this.control = null;
    }
  }

  // === WS connection handling ===

  private acceptWs(socket: WebSocket): void {
    const id = `c${++this.connSeq}`;
    const replay = new ConnectionReplay(this.opts.fixture, this.opts.loop);
    const state: ConnectionState = { socket, replay, emitTimer: null, id };
    this.connections.set(id, state);

    socket.on('message', (data) => this.handleClientMessage(state, data.toString('utf8')));
    socket.on('close', () => this.dropConnection(id));
    socket.on('error', () => this.dropConnection(id));

    if (this.opts.rateHz > 0) {
      const intervalMs = Math.max(1, Math.floor(1000 / this.opts.rateHz));
      state.emitTimer = setInterval(() => this.tickEmit(state), intervalMs);
    }
  }

  private dropConnection(id: string): void {
    const conn = this.connections.get(id);
    if (!conn) return;
    if (conn.emitTimer) clearInterval(conn.emitTimer);
    try { conn.socket.close(); } catch { /* ignore */ }
    this.connections.delete(id);
  }

  private handleClientMessage(state: ConnectionState, raw: string): void {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return;
    }
    const result = SubscribeOpSchema.safeParse(json);
    if (!result.success) return;
    const op = result.data;
    if (op.channel === 'subscriptions') return; // we don't honor subscription-channel ops; harmless
    const channel: Channel = op.channel;

    if (op.type === 'subscribe') {
      state.replay.subscribe(channel, op.product_ids);
    } else {
      state.replay.unsubscribe(channel, op.product_ids);
    }

    // Respond with a `subscriptions` envelope echoing current state. This
    // mirrors Coinbase's behavior of acking subs out-of-band.
    this.sendEnvelope(state, {
      channel: 'subscriptions',
      timestamp: new Date().toISOString(),
      sequence_num: 0, // overwritten by replay sequence assignment for next data env
      events: [{ subscriptions: this.subscriptionsByChannel(state) }],
    });
  }

  private subscriptionsByChannel(state: ConnectionState): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const s of state.replay.subscriptionSnapshot()) {
      const [ch, p] = s.split(':');
      if (!ch || !p) continue;
      if (!out[ch]) out[ch] = [];
      if (p !== '*') out[ch].push(p);
    }
    return out;
  }

  private tickEmit(state: ConnectionState): void {
    if (state.replay.isSilenced()) return;
    if (state.socket.readyState !== state.socket.OPEN) return;
    const env = state.replay.next();
    if (env) this.sendEnvelope(state, env);
  }

  private sendEnvelope(state: ConnectionState, env: Envelope): void {
    if (state.socket.readyState !== state.socket.OPEN) return;
    try {
      state.socket.send(JSON.stringify(env));
    } catch {
      // ignore; close handler will reap
    }
  }

  // === Control plane ===

  private handleControl(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const path = url.pathname;

    if (req.method === 'GET' && path === '/control/state') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        wsPort: this.opts.wsPort,
        controlPort: this.opts.controlPort,
        connections: [...this.connections.values()].map((c) => ({
          id: c.id,
          subscriptions: c.replay.subscriptionSnapshot(),
        })),
      }));
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(405).end();
      return;
    }

    if (path === '/control/inject-gap') {
      for (const c of this.connections.values()) c.replay.injectGap();
      res.writeHead(200).end('{"ok":true}');
      return;
    }
    if (path === '/control/disconnect') {
      for (const c of this.connections.values()) {
        try { c.socket.close(1011, 'control:disconnect'); } catch { /* ignore */ }
      }
      res.writeHead(200).end('{"ok":true}');
      return;
    }
    if (path === '/control/silence') {
      const ms = Number(url.searchParams.get('ms') ?? '1000');
      for (const c of this.connections.values()) c.replay.silenceFor(ms);
      res.writeHead(200).end(`{"ok":true,"silencedMs":${ms}}`);
      return;
    }
    if (path === '/control/slow') {
      const intervalMs = Number(url.searchParams.get('ms') ?? '1000');
      for (const c of this.connections.values()) {
        if (c.emitTimer) clearInterval(c.emitTimer);
        c.emitTimer = setInterval(() => this.tickEmit(c), Math.max(1, intervalMs));
      }
      res.writeHead(200).end(`{"ok":true,"intervalMs":${intervalMs}}`);
      return;
    }

    res.writeHead(404).end();
  }
}

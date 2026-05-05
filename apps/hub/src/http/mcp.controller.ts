import {
  All,
  Controller,
  Inject,
  Optional,
  Req,
  Res,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { LOGGER, REGISTRY, type Registry } from '@silver8/core';
import type { Logger } from '@silver8/observability';
import {
  McpConsumerHandle,
  McpServerService,
  type SessionRegistry,
} from '@silver8/mcp-server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';

/**
 * Stateful HTTP transport for MCP (DEC-014, DEC-035).
 *
 * On `initialize` (no `Mcp-Session-Id` header), a fresh
 * `StreamableHTTPServerTransport` is created with `sessionIdGenerator`, paired
 * with a per-session `McpServer` from `mcp.createSessionServer(handle)`, and
 * the handle is registered with the Registry as a consumer (`surface = 'mcp'`).
 * Subsequent requests on the same session route through the existing
 * transport's `handleRequest`. SSE notifications (`notifications/resources/updated`)
 * flow over the long-lived transport.
 *
 * Sessions reap on:
 *  - transport close (client closes SSE OR sends DELETE /mcp)
 *  - 5-minute idle (configurable via MCP_SESSION_IDLE_MS)
 *  - drain (DEC-019) — service iterates sessions, broadcasts rebalance,
 *    force-closes after deadline
 */

interface McpSession {
  id: string;
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  handle: McpConsumerHandle;
  lastActivity: number;
}

const REAPER_INTERVAL_MS = 60_000;

@Controller()
export class McpController implements OnApplicationBootstrap, OnModuleDestroy {
  private transportClass: unknown = null;
  private readonly sessions = new Map<string, McpSession>();
  private reaperTimer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(REGISTRY) private readonly registry: Registry,
    @Optional() @Inject(McpServerService) private readonly mcp?: McpServerService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.mcp || this.env.MCP_TRANSPORT !== 'http') return;

    // Expose the session map to the service so its drain() can iterate.
    const sessionRegistry: SessionRegistry = {
      count: () => this.sessions.size,
      forEach: (cb) => {
        for (const s of this.sessions.values()) cb(s.handle);
      },
      closeAll: (reason) => {
        for (const s of this.sessions.values()) {
          s.handle.disconnect(reason);
        }
      },
    };
    this.mcp.setSessionRegistry(sessionRegistry);

    // Idle-session reaper. Single interval scans the (small) session map and
    // closes any session whose lastActivity is older than the configured TTL.
    // The transport's onclose handler then runs dropSession to clean up.
    const idleMs = this.mcp.config.sessionIdleMs;
    if (idleMs > 0) {
      this.reaperTimer = setInterval(() => this.reapIdleSessions(idleMs), REAPER_INTERVAL_MS);
      // Don't keep the event loop alive just for the reaper.
      this.reaperTimer.unref?.();
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.reaperTimer) {
      clearInterval(this.reaperTimer);
      this.reaperTimer = null;
    }
    // Drop any remaining sessions cleanly.
    for (const s of [...this.sessions.values()]) {
      this.dropSession(s.id);
    }
  }

  @All('/mcp')
  async handle(@Req() req: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    if (this.env.MCP_TRANSPORT !== 'http') {
      reply.status(404).send({
        error: 'mcp_http_disabled',
        message:
          'MCP HTTP transport is disabled in this deployment. Set MCP_TRANSPORT=http to enable.',
      });
      return;
    }
    if (!this.mcp) {
      reply.status(503).send({
        error: 'mcp_not_loaded',
        message: 'MCP server is not loaded in this deployment.',
      });
      return;
    }

    const sessionIdHeader = (req.headers['mcp-session-id'] ?? req.headers['Mcp-Session-Id']) as
      | string
      | undefined;

    // Existing session — route through its transport.
    if (sessionIdHeader) {
      const session = this.sessions.get(sessionIdHeader);
      if (session) {
        session.lastActivity = Date.now();
        try {
          await session.transport.handleRequest(req.raw, reply.raw, req.body);
        } catch (err) {
          this.logger.error(
            { err: { message: (err as Error).message }, sessionId: sessionIdHeader },
            'mcp http session handleRequest threw',
          );
          if (!reply.sent) {
            reply.status(500).send({ error: 'mcp_internal_error', message: (err as Error).message });
          }
        }
        return;
      }
      // Header sent but session unknown (reaped or stale client). The SDK's
      // own contract returns 404 in this case so the client knows to re-init.
      reply.status(404).send({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Session not found; re-initialize.' },
        id: null,
      });
      return;
    }

    // No session id — must be an initialize request.
    if (!isInitializeRequest(req.body)) {
      reply.status(400).send({
        jsonrpc: '2.0',
        error: {
          code: -32600,
          message:
            'Bad Request: no session id provided and request is not an initialize. ' +
            'Send `initialize` first; the response carries Mcp-Session-Id which subsequent requests must echo.',
        },
        id: null,
      });
      return;
    }

    // New session.
    if (!this.transportClass) {
      const mod = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
      this.transportClass = mod.StreamableHTTPServerTransport;
    }
    const TransportCtor = this.transportClass as new (
      opts: {
        sessionIdGenerator: () => string;
        onsessioninitialized?: (sessionId: string) => void;
        onsessionclosed?: (sessionId: string) => void;
      },
    ) => StreamableHTTPServerTransport;

    let pendingTransport: StreamableHTTPServerTransport | null = null;
    let pendingServer: McpServer | null = null;
    let pendingHandle: McpConsumerHandle | null = null;

    const transport = new TransportCtor({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        // Now that the SDK has minted an id, we have everything to register
        // the session. The closure captures pendingServer/Transport/Handle
        // declared just above.
        if (!pendingServer || !pendingTransport || !pendingHandle) return;
        pendingHandle.attachSessionId(sessionId);
        const session: McpSession = {
          id: sessionId,
          server: pendingServer,
          transport: pendingTransport,
          handle: pendingHandle,
          lastActivity: Date.now(),
        };
        this.sessions.set(sessionId, session);
        this.registry.registerConsumer(pendingHandle);
      },
      onsessionclosed: (sessionId) => {
        this.dropSession(sessionId);
      },
    });

    transport.onclose = () => {
      const id = transport.sessionId;
      if (id) this.dropSession(id);
    };

    // Build the handle BEFORE the server (the server's subscribe handler
    // needs a handle reference to call deliver()). Session id isn't known
    // yet — we attach it in onsessioninitialized. The server is attached
    // back to the handle below so deliver() / sendEvent() can fire SSE
    // notifications through it.
    const handle = new McpConsumerHandle('pending', transport);
    const server = this.mcp.createSessionServer(handle);
    handle.attachServer(server);
    pendingTransport = transport;
    pendingServer = server;
    pendingHandle = handle;

    try {
      await server.connect(transport);
      await transport.handleRequest(req.raw, reply.raw, req.body);
    } catch (err) {
      this.logger.error({ err: { message: (err as Error).message } }, 'mcp http initialize threw');
      if (!reply.sent) {
        reply.status(500).send({ error: 'mcp_internal_error', message: (err as Error).message });
      }
      // If we set up a session before the throw, clean it up.
      if (transport.sessionId && this.sessions.has(transport.sessionId)) {
        this.dropSession(transport.sessionId);
      } else {
        try { await transport.close(); } catch { /* ignore */ }
        try { await server.close(); } catch { /* ignore */ }
      }
    }
  }

  private dropSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    if (this.mcp) this.mcp.cleanupSessionServer(session.server);
    this.registry.removeConsumer(session.handle.id);
    void session.transport.close().catch(() => { /* already closed */ });
    void session.server.close().catch(() => { /* already closed */ });
    this.logger.info({ sessionId }, 'mcp session closed');
  }

  private reapIdleSessions(idleMs: number): void {
    const now = Date.now();
    for (const session of [...this.sessions.values()]) {
      if (now - session.lastActivity > idleMs) {
        this.logger.info(
          { sessionId: session.id, idleMs: now - session.lastActivity },
          'mcp session idle; reaping',
        );
        // Closing the transport triggers onclose → dropSession.
        session.handle.disconnect('idle');
      }
    }
  }
}

function randomUUID(): string {
  return globalThis.crypto.randomUUID();
}

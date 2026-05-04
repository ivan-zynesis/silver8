import { All, Controller, Inject, Optional, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { LOGGER } from '@silver8/core';
import type { Logger } from '@silver8/observability';
import { McpServerService } from '@silver8/mcp-server';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';

/**
 * Mounts the MCP HTTP transport at the configured path (default /mcp) when
 * MCP_TRANSPORT=http (DEC-014). For MCP_TRANSPORT=stdio the controller stays
 * loaded but the transport binding is a no-op (the McpServerService binds stdio
 * directly during onApplicationBootstrap).
 *
 * Uses StreamableHTTPServerTransport in stateless mode: a fresh transport per
 * request, connected to the same shared McpServer instance for the duration of
 * the request. Suitable for the take-home; stateful sessions can be added later.
 */
@Controller()
export class McpController {
  private transportClass: unknown = null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(LOGGER) private readonly logger: Logger,
    // Explicit @Inject() so dev mode (tsx watch / esbuild) resolves the
    // token without relying on emitted parameter type metadata.
    @Optional() @Inject(McpServerService) private readonly mcp?: McpServerService,
  ) {}

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

    if (!this.transportClass) {
      const mod = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
      this.transportClass = mod.StreamableHTTPServerTransport;
    }
    const TransportCtor = this.transportClass as new (
      opts: { sessionIdGenerator: undefined },
    ) => {
      handleRequest: (
        req: unknown,
        res: unknown,
        body?: unknown,
      ) => Promise<void>;
      close: () => Promise<void>;
    };

    // Stateless mode: undefined sessionIdGenerator means each request stands alone.
    const transport = new TransportCtor({ sessionIdGenerator: undefined });

    try {
      await this.mcp.mcp.connect(transport as never);
      await transport.handleRequest(req.raw, reply.raw, req.body);
    } catch (err) {
      this.logger.error({ err: { message: (err as Error).message } }, 'mcp http transport error');
      if (!reply.sent) {
        reply.status(500).send({ error: 'mcp_internal_error', message: (err as Error).message });
      }
    } finally {
      try { await transport.close(); } catch { /* ignore */ }
    }
  }
}

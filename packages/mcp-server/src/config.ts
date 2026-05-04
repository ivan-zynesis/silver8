export type McpTransport = 'http' | 'stdio';

export interface McpServerConfig {
  transport: McpTransport;
  /** Path mounted on the Fastify HTTP server when transport=http. */
  httpPath: string;
  /**
   * HTTP port the hub listens on. Surfaced in /status.mcp so the dashboard
   * can render a snippet pointing at the hub directly, regardless of
   * whether the dashboard is served from the hub or from Vite dev (which
   * runs on a different port).
   */
  httpPort: number;
  /** Drain grace period for SIGTERM rebalance hint. */
  drainDeadlineMs: number;
}

export const MCP_SERVER_CONFIG = Symbol.for('silver8.McpServerConfig');

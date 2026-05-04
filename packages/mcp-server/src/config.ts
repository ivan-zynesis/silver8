export type McpTransport = 'http' | 'stdio';

export interface McpServerConfig {
  transport: McpTransport;
  /** Path mounted on the Fastify HTTP server when transport=http. */
  httpPath: string;
  /** Drain grace period for SIGTERM rebalance hint. */
  drainDeadlineMs: number;
}

export const MCP_SERVER_CONFIG = Symbol.for('silver8.McpServerConfig');

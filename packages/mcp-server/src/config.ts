export type McpTransport = 'http' | 'stdio';

export interface McpServerConfig {
  transport: McpTransport;
  /** Path mounted on the Fastify HTTP server when transport=http. */
  httpPath: string;
  /** Drain grace period for SIGTERM rebalance hint. */
  drainDeadlineMs: number;
  /** Symbols to expose as resources (typically the same as ingestion's symbols). */
  symbols: string[];
}

export const MCP_SERVER_CONFIG = Symbol.for('silver8.McpServerConfig');

// Module surface filled in by Milestone 4 (mcp-server).

import { Module } from '@nestjs/common';

export type McpTransport = 'http' | 'stdio';

export interface McpServerConfig {
  transport: McpTransport;
  /** Required when transport=http; ignored for stdio. */
  httpPath?: string;
  /** Drain grace period for SIGTERM rebalance hint. */
  drainDeadlineMs: number;
}

@Module({
  providers: [],
  exports: [],
})
export class McpServerModule {
  static forRoot(_config: McpServerConfig) {
    return {
      module: McpServerModule,
      providers: [],
      exports: [],
    };
  }
}

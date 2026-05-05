import { Module, type DynamicModule } from '@nestjs/common';
import { MCP_SERVER_CONFIG, type McpServerConfig } from './config.js';
import { McpServerService } from './mcp-server.service.js';

export type { McpServerConfig, McpTransport } from './config.js';
export { McpServerService, type SessionRegistry } from './mcp-server.service.js';
export { McpConsumerHandle } from './mcp-consumer-handle.js';
export { buildMcpStatus, type McpHubStatus } from './status-builder.js';

@Module({})
export class McpServerModule {
  static forRoot(config: McpServerConfig): DynamicModule {
    return {
      module: McpServerModule,
      global: true,
      providers: [
        { provide: MCP_SERVER_CONFIG, useValue: config },
        McpServerService,
      ],
      exports: [McpServerService],
    };
  }
}

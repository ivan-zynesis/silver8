import { Module, type DynamicModule } from '@nestjs/common';
import { GatewayWsModule } from '@silver8/gateway-ws';
import { IngestionModule } from '@silver8/ingestion';
import { McpServerModule } from '@silver8/mcp-server';
import { ConfigModule } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { HttpModule } from '../http/http.module.js';
import { CoreMemoryModule } from './core-memory.module.js';
import { ObservabilityModule } from './observability.module.js';

/**
 * MODE=monolith — the default deployment variant (DEC-016).
 * Wires all components in a single process, backed by in-memory seams.
 *
 * Catalog symbols are not injected here: per DEC-031 the production catalog is
 * a hardcoded constant inside the ingestion package. McpServerModule and
 * GatewayWsModule discover available symbols via the VENUE_ADAPTER_CATALOG
 * token exported by IngestionModule.
 */
@Module({})
export class MonolithModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: MonolithModule,
      imports: [
        ConfigModule,
        ObservabilityModule,
        CoreMemoryModule,
        HttpModule,

        IngestionModule.forRoot({
          lifecycle: env.INGESTION_LIFECYCLE,
          socketIdleMs: env.INGESTION_SOCKET_IDLE_MS,
          coinbase: { url: env.COINBASE_WS_URL },
        }),

        GatewayWsModule.forRoot({
          port: env.WS_PORT,
          queueDepth: env.GATEWAY_QUEUE_DEPTH,
          overflowDisconnectMs: env.GATEWAY_OVERFLOW_DISCONNECT_MS,
          bufferedWatermarkBytes: env.GATEWAY_BUFFERED_WATERMARK_BYTES,
          drainDeadlineMs: env.DRAIN_DEADLINE_MS,
        }),

        McpServerModule.forRoot({
          transport: env.MCP_TRANSPORT,
          httpPath: '/mcp',
          httpPort: env.HTTP_PORT,
          drainDeadlineMs: env.DRAIN_DEADLINE_MS,
          sessionIdleMs: env.MCP_SESSION_IDLE_MS,
        }),
      ],
      providers: [],
      exports: [],
    };
  }
}

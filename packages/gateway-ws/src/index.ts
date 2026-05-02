import { Module, type DynamicModule } from '@nestjs/common';
import { GATEWAY_WS_CONFIG, type GatewayWsConfig } from './config.js';
import { WsGatewayService } from './ws-gateway.service.js';

export type { GatewayWsConfig } from './config.js';

@Module({})
export class GatewayWsModule {
  static forRoot(config: GatewayWsConfig): DynamicModule {
    return {
      module: GatewayWsModule,
      // Global so StatusController and downstream readers can inject the service.
      global: true,
      providers: [
        { provide: GATEWAY_WS_CONFIG, useValue: config },
        WsGatewayService,
      ],
      exports: [WsGatewayService],
    };
  }
}

export { WsGatewayService } from './ws-gateway.service.js';
export { WsConsumerHandle } from './ws-consumer-handle.js';
export { BoundedQueue } from './bounded-queue.js';
export * from './protocol.js';

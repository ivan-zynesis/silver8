// Module surface filled in by Milestone 3 (gateway-ws).

import { Module } from '@nestjs/common';

export interface GatewayWsConfig {
  port: number;
  /** Bounded ring buffer per consumer-subscription (DEC-011). */
  queueDepth: number;
  /** Sustained-overflow window before disconnect, in ms. */
  overflowDisconnectMs: number;
  /** ws.bufferedAmount watermark for backpressure. */
  bufferedWatermarkBytes: number;
  /** Drain grace period (server SIGTERM → close-all). */
  drainDeadlineMs: number;
}

@Module({
  providers: [],
  exports: [],
})
export class GatewayWsModule {
  static forRoot(_config: GatewayWsConfig) {
    return {
      module: GatewayWsModule,
      providers: [],
      exports: [],
    };
  }
}

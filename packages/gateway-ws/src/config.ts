export interface GatewayWsConfig {
  port: number;
  queueDepth: number;
  overflowDisconnectMs: number;
  bufferedWatermarkBytes: number;
  drainDeadlineMs: number;
}

export const GATEWAY_WS_CONFIG = Symbol.for('silver8.GatewayWsConfig');

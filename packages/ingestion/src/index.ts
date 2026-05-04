import { Module, type DynamicModule } from '@nestjs/common';
import { BookMaintainer } from './book/book-maintainer.js';
import {
  CoinbaseAdapter,
  COINBASE_ADAPTER_CONFIG,
  type CoinbaseAdapterConfig,
} from './coinbase/coinbase.adapter.js';
import { CoinbaseProtocolHandler } from './coinbase/coinbase.protocol-handler.js';
import { IngestionService } from './ingestion.service.js';
import {
  INGESTION_RUNTIME_CONFIG,
  type IngestionRuntimeConfig,
} from './runtime-config.js';

export interface IngestionConfig {
  venues: Array<{
    venue: 'coinbase';
    symbols: string[];
  }>;
  /**
   * Lifecycle mode (DEC-027).
   *  - `demand_driven` (default): upstream channels subscribe only on consumer demand.
   *  - `eager`: pre-subscribe at boot — useful for keeping books warm without consumers.
   */
  lifecycle?: 'demand_driven' | 'eager';
  /** Idle window (ms) before closing the upstream WS socket when zero channels. */
  socketIdleMs?: number;
  /** Optional Coinbase adapter overrides. */
  coinbase?: Partial<
    Pick<CoinbaseAdapterConfig, 'url' | 'heartbeatTimeoutMs' | 'reconnectInitialMs' | 'reconnectMaxMs'>
  >;
}

@Module({})
export class IngestionModule {
  static forRoot(config: IngestionConfig): DynamicModule {
    const cb = config.venues.find((v) => v.venue === 'coinbase');
    const symbols = cb?.symbols ?? [];
    const lifecycle: 'demand_driven' | 'eager' = config.lifecycle ?? 'demand_driven';
    const socketIdleMs = config.socketIdleMs ?? 300_000;

    const coinbaseConfig: CoinbaseAdapterConfig = {
      url: config.coinbase?.url ?? 'wss://advanced-trade-ws.coinbase.com',
      symbols,
      heartbeatTimeoutMs: config.coinbase?.heartbeatTimeoutMs ?? 30_000,
      reconnectInitialMs: config.coinbase?.reconnectInitialMs ?? 1_000,
      reconnectMaxMs: config.coinbase?.reconnectMaxMs ?? 30_000,
      socketIdleMs,
    };

    const runtimeConfig: IngestionRuntimeConfig = { lifecycle, symbols };

    return {
      module: IngestionModule,
      // Global so StatusController and the future MCP get_hub_status tool can
      // inject IngestionService without re-importing this module.
      global: true,
      providers: [
        { provide: COINBASE_ADAPTER_CONFIG, useValue: coinbaseConfig },
        { provide: INGESTION_RUNTIME_CONFIG, useValue: runtimeConfig },
        BookMaintainer,
        CoinbaseProtocolHandler,
        CoinbaseAdapter,
        IngestionService,
      ],
      exports: [IngestionService, BookMaintainer, CoinbaseProtocolHandler, CoinbaseAdapter],
    };
  }
}

export { IngestionService } from './ingestion.service.js';
export { BookMaintainer } from './book/book-maintainer.js';
export { CoinbaseProtocolHandler } from './coinbase/coinbase.protocol-handler.js';
export { CoinbaseAdapter } from './coinbase/coinbase.adapter.js';
export type { AdapterStatus } from './coinbase/coinbase.adapter.js';
export {
  INGESTION_RUNTIME_CONFIG,
  type IngestionRuntimeConfig,
} from './runtime-config.js';

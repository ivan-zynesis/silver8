import { Module, type DynamicModule } from '@nestjs/common';
import { BookMaintainer } from './book/book-maintainer.js';
import {
  CoinbaseAdapter,
  COINBASE_ADAPTER_CONFIG,
  type CoinbaseAdapterConfig,
} from './coinbase/coinbase.adapter.js';
import { CoinbaseProtocolHandler } from './coinbase/coinbase.protocol-handler.js';
import { IngestionService } from './ingestion.service.js';

export interface IngestionConfig {
  venues: Array<{
    venue: 'coinbase';
    symbols: string[];
  }>;
  /** Fail readyz until at least one upstream connection succeeds. */
  requireUpstreamForReady: boolean;
  /** Optional overrides; sensible defaults applied. */
  coinbase?: Partial<
    Pick<CoinbaseAdapterConfig, 'url' | 'heartbeatTimeoutMs' | 'reconnectInitialMs' | 'reconnectMaxMs'>
  >;
}

@Module({})
export class IngestionModule {
  static forRoot(config: IngestionConfig): DynamicModule {
    const cb = config.venues.find((v) => v.venue === 'coinbase');
    const coinbaseConfig: CoinbaseAdapterConfig = {
      url: config.coinbase?.url ?? 'wss://advanced-trade-ws.coinbase.com',
      symbols: cb?.symbols ?? [],
      heartbeatTimeoutMs: config.coinbase?.heartbeatTimeoutMs ?? 30_000,
      reconnectInitialMs: config.coinbase?.reconnectInitialMs ?? 1_000,
      reconnectMaxMs: config.coinbase?.reconnectMaxMs ?? 30_000,
    };

    return {
      module: IngestionModule,
      // Global so StatusController (in HttpModule) and the future MCP get_hub_status
      // tool can inject IngestionService without re-importing this module.
      global: true,
      providers: [
        { provide: COINBASE_ADAPTER_CONFIG, useValue: coinbaseConfig },
        BookMaintainer,
        CoinbaseProtocolHandler,
        CoinbaseAdapter,
        IngestionService,
      ],
      exports: [IngestionService, BookMaintainer, CoinbaseProtocolHandler],
    };
  }
}

export { IngestionService } from './ingestion.service.js';
export { BookMaintainer } from './book/book-maintainer.js';
export { CoinbaseProtocolHandler } from './coinbase/coinbase.protocol-handler.js';
export { CoinbaseAdapter } from './coinbase/coinbase.adapter.js';
export type { AdapterStatus } from './coinbase/coinbase.adapter.js';

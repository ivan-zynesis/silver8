import { Module, type DynamicModule } from '@nestjs/common';
import { VENUE_ADAPTER_CATALOG } from '@silver8/core';
import { BookMaintainer } from './book/book-maintainer.js';
import {
  CoinbaseAdapter,
  COINBASE_ADAPTER_CONFIG,
  type CoinbaseAdapterConfig,
} from './coinbase/coinbase.adapter.js';
import { CoinbaseProtocolHandler } from './coinbase/coinbase.protocol-handler.js';
import { COINBASE_DEFAULT_SYMBOLS } from './coinbase/coinbase-catalog.js';
import { IngestionService } from './ingestion.service.js';
import {
  INGESTION_RUNTIME_CONFIG,
  type IngestionRuntimeConfig,
} from './runtime-config.js';

export interface IngestionConfig {
  /**
   * Symbol set for the Coinbase venue adapter's catalog (DEC-030 / DEC-031).
   *
   * Production callers omit this; the IngestionModule sources symbols from
   * `COINBASE_DEFAULT_SYMBOLS` (the hardcoded production catalog). Tests pass
   * a custom symbol list to exercise specific scenarios — that's the only
   * intended override path. There is no env-var configurability per DEC-031.
   */
  coinbaseSymbols?: readonly string[];
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
  static forRoot(config: IngestionConfig = {}): DynamicModule {
    const symbols = [...(config.coinbaseSymbols ?? COINBASE_DEFAULT_SYMBOLS)];
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
        // The same CoinbaseAdapter instance is exposed via the venue-adapter
        // catalog token (DEC-030) so consumers (gateway, mcp) depend on the
        // VenueAdapterCatalog interface, not the concrete adapter class.
        { provide: VENUE_ADAPTER_CATALOG, useExisting: CoinbaseAdapter },
        IngestionService,
      ],
      exports: [
        IngestionService,
        BookMaintainer,
        CoinbaseProtocolHandler,
        CoinbaseAdapter,
        VENUE_ADAPTER_CATALOG,
      ],
    };
  }
}

export { IngestionService } from './ingestion.service.js';
export { BookMaintainer } from './book/book-maintainer.js';
export { CoinbaseProtocolHandler } from './coinbase/coinbase.protocol-handler.js';
export { CoinbaseAdapter } from './coinbase/coinbase.adapter.js';
export type { AdapterStatus } from './coinbase/coinbase.adapter.js';
export {
  COINBASE_DEFAULT_SYMBOLS,
  buildCoinbaseCatalog,
} from './coinbase/coinbase-catalog.js';
export {
  INGESTION_RUNTIME_CONFIG,
  type IngestionRuntimeConfig,
} from './runtime-config.js';

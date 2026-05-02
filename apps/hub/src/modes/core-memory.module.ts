import { Global, Module } from '@nestjs/common';
import {
  InMemoryBus,
  InMemoryOrderBookStore,
  InMemoryRegistry,
} from '@silver8/core-memory';
import { BUS, ORDER_BOOK_STORE, REGISTRY } from '@silver8/core';

/**
 * Provides in-memory implementations of the three architectural seams (DEC-004, DEC-005, DEC-006).
 * Imported by MonolithModule. The hypothetical CoreNetworkModule (Redis/NATS-backed,
 * for split-tier deployment per DEC-016) would provide the same tokens with different
 * implementations and would be imported by IngestionModeModule / GatewayModeModule.
 *
 * `@Global()` so any module can inject the seam tokens without re-importing this.
 */
@Global()
@Module({
  providers: [
    { provide: BUS, useClass: InMemoryBus },
    { provide: ORDER_BOOK_STORE, useClass: InMemoryOrderBookStore },
    { provide: REGISTRY, useClass: InMemoryRegistry },
  ],
  exports: [BUS, ORDER_BOOK_STORE, REGISTRY],
})
export class CoreMemoryModule {}

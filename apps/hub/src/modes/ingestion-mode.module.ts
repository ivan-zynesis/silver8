import type { DynamicModule } from '@nestjs/common';
import { CompositionError } from '@silver8/core';
import type { Env } from '../config/env.js';

/**
 * MODE=ingestion (DEC-016) — production ingestion tier.
 *
 * In v1 we deliberately ship the *composition entry point* but not the
 * `CoreNetworkModule` it depends on. Booting in this mode fails fast with a
 * clear message, which is itself the architectural argument: the binary CAN
 * be deployed as a separate ingestion tier; it just needs the network-backed
 * Bus / OrderBookStore / Registry adapters to be ready.
 *
 * See opensprint/ADRs/DEC-016.md for the design.
 */
export class IngestionModeModule {
  static forRoot(_env: Env): DynamicModule {
    throw new CompositionError(
      'MODE=ingestion requires CoreNetworkModule ' +
        '(Redis/NATS-backed Bus, OrderBookStore, Registry).\n' +
        'CoreNetworkModule is deferred from v1; only MODE=monolith is fully wired.\n' +
        'See opensprint/ADRs/DEC-016.md for the deployment-variant design.',
    );
  }
}

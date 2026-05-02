import type { DynamicModule } from '@nestjs/common';
import { CompositionError } from '@silver8/core';
import type { Env } from '../config/env.js';

/**
 * MODE=gateway (DEC-016) — production gateway tier (WS + MCP).
 *
 * Ships as a composition entry point only; the `CoreNetworkModule` adapters
 * needed to subscribe to a remote Bus / read a remote OrderBookStore / share
 * a remote Registry are deferred from v1. See opensprint/ADRs/DEC-016.md.
 */
export class GatewayModeModule {
  static forRoot(_env: Env): DynamicModule {
    throw new CompositionError(
      'MODE=gateway requires CoreNetworkModule ' +
        '(Redis/NATS-backed Bus, OrderBookStore, Registry).\n' +
        'CoreNetworkModule is deferred from v1; only MODE=monolith is fully wired.\n' +
        'See opensprint/ADRs/DEC-016.md for the deployment-variant design.',
    );
  }
}

// Module surface filled in by Milestone 2 (ingestion-coinbase-l2).
// In M1 this exports an empty NestJS module so the composition root can wire it
// into MODE=monolith / MODE=ingestion variants without circular references.

import { Module } from '@nestjs/common';

export interface IngestionConfig {
  venues: Array<{
    venue: 'coinbase';
    symbols: string[];
  }>;
  /** Fail readyz until at least one upstream connection succeeds. */
  requireUpstreamForReady: boolean;
}

@Module({
  providers: [],
  exports: [],
})
export class IngestionModule {
  static forRoot(_config: IngestionConfig) {
    return {
      module: IngestionModule,
      providers: [],
      exports: [],
    };
  }
}

import { Module } from '@nestjs/common';
import { LOGGER } from '@silver8/core';
import { createLogger } from '@silver8/observability';
import { ConfigModule, ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: LOGGER,
      useFactory: (env: Env) =>
        createLogger({
          level: env.LOG_LEVEL,
          pretty: env.LOG_PRETTY,
          base: { service: 'silver8-hub', mode: env.MODE },
        }),
      inject: [ENV],
    },
  ],
  exports: [LOGGER],
})
export class ObservabilityModule {}

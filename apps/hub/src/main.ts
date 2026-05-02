import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import type { DynamicModule } from '@nestjs/common';
import { CompositionError } from '@silver8/core';
import { createLogger } from '@silver8/observability';
import { loadEnv, type Env } from './config/env.js';
import { MonolithModule } from './modes/monolith.module.js';
import { IngestionModeModule } from './modes/ingestion-mode.module.js';
import { GatewayModeModule } from './modes/gateway-mode.module.js';

function selectRootModule(env: Env): DynamicModule {
  switch (env.MODE) {
    case 'monolith':
      return MonolithModule.forRoot(env);
    case 'ingestion':
      return IngestionModeModule.forRoot(env);
    case 'gateway':
      return GatewayModeModule.forRoot(env);
  }
}

async function bootstrap(): Promise<void> {
  const bootLogger = createLogger({ base: { phase: 'bootstrap' } });

  let env: Env;
  try {
    env = loadEnv();
  } catch (err) {
    bootLogger.fatal({ err }, 'environment validation failed');
    process.exit(1);
  }

  bootLogger.info({ mode: env.MODE, httpPort: env.HTTP_PORT }, 'starting hub');

  let rootModule: DynamicModule;
  try {
    rootModule = selectRootModule(env);
  } catch (err) {
    if (err instanceof CompositionError) {
      // Clean exit with the composition message; this is the autoscale-/split-tier-readiness signal.
      bootLogger.fatal({ mode: env.MODE, message: err.message }, 'composition error');
    } else {
      bootLogger.fatal({ err }, 'unexpected error during composition');
    }
    process.exit(1);
  }

  const app = await NestFactory.create<NestFastifyApplication>(
    rootModule,
    new FastifyAdapter({ trustProxy: true }),
    { bufferLogs: false },
  );

  app.enableShutdownHooks();

  await app.listen(env.HTTP_PORT, '0.0.0.0');
  bootLogger.info(
    { httpPort: env.HTTP_PORT, mode: env.MODE },
    'hub listening; /healthz /readyz /metrics /status available',
  );
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('fatal bootstrap error:', err);
  process.exit(1);
});

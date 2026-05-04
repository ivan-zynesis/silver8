import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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

  // Serve the dashboard SPA at /dashboard if its build output is present.
  // Production: copied into the image at build time. Dev: built via
  // `pnpm --filter @silver8/dashboard build`. Missing dist => /dashboard 404s
  // which is acceptable (the dashboard is a deliverable, not a hard requirement).
  const dashboardDist = resolveDashboardDist();
  if (dashboardDist) {
    app.useStaticAssets({
      root: dashboardDist,
      prefix: '/dashboard/',
      decorateReply: false,
    });
    bootLogger.info({ dashboardDist }, 'dashboard mounted at /dashboard');
  } else {
    bootLogger.warn(
      'dashboard build not found; /dashboard will 404. Run `pnpm --filter @silver8/dashboard build`.',
    );
  }

  await app.listen(env.HTTP_PORT, '0.0.0.0');
  bootLogger.info(
    { httpPort: env.HTTP_PORT, mode: env.MODE },
    'hub listening; /healthz /readyz /metrics /status /dashboard available',
  );
}

/**
 * Locate the dashboard's built static files. Tries a few candidates so the same
 * binary works in dev (running from source via tsx) and in the production image
 * (where main.js lives in apps/hub/dist next to the dashboard's dist).
 */
function resolveDashboardDist(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '../../dashboard/dist'),       // apps/hub/dist/.. → apps/dashboard/dist
    resolve(here, '../../../apps/dashboard/dist'), // apps/hub/src/.. → repo/apps/dashboard/dist (when running from src)
    resolve(process.cwd(), 'apps/dashboard/dist'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('fatal bootstrap error:', err);
  process.exit(1);
});

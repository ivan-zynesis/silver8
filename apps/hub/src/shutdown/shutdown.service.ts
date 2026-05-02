import {
  Inject,
  Injectable,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { LOGGER, type Drainable, type DrainableRegistrar } from '@silver8/core';
import type { Logger } from '@silver8/observability';
import { ReadinessService } from '../readiness/readiness.service.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';

/**
 * Drainable orchestration (DEC-019). The SIGTERM sequence:
 *   1. Flip /readyz to not-ready (LB stops new conns).
 *   2. Call drain() on every Drainable. Each drainable broadcasts a rebalance
 *      hint to its consumers.
 *   3. Wait up to DRAIN_DEADLINE_MS for consumers to reconnect elsewhere.
 *   4. Force-close anything still attached and exit.
 *
 * Implements DrainableRegistrar from @silver8/core so subsystem packages can
 * register themselves without depending on apps/hub.
 */
@Injectable()
export class ShutdownService implements OnApplicationShutdown, DrainableRegistrar {
  private readonly drainables: Drainable[] = [];

  constructor(
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(ENV) private readonly env: Env,
    private readonly readiness: ReadinessService,
  ) {}

  register(drainable: Drainable): void {
    this.drainables.push(drainable);
  }

  async onApplicationShutdown(signal?: string): Promise<void> {
    this.logger.info({ signal }, 'shutdown initiated; entering drain');
    this.readiness.markDraining();

    // Drain in reverse-registration order (last-in, first-out): gateway/MCP shed
    // their consumers before ingestion stops feeding them updates.
    const ordered = [...this.drainables].reverse();
    const deadline = this.env.DRAIN_DEADLINE_MS;

    await Promise.allSettled(
      ordered.map(async (d) => {
        const start = Date.now();
        try {
          await d.drain(deadline);
          this.logger.info(
            { drainable: d.drainName, durationMs: Date.now() - start },
            'drained',
          );
        } catch (err) {
          this.logger.error(
            { drainable: d.drainName, err },
            'drain failed; continuing shutdown',
          );
        }
      }),
    );
  }
}

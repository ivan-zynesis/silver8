import { Controller, Get, HttpCode, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ReadinessService } from '../readiness/readiness.service.js';

/**
 * Liveness vs readiness:
 *   /healthz — am I a live Node process? (is the event loop running)
 *   /readyz  — should the LB send me consumer connections?
 *               false during startup, false during drain, false if any
 *               registered component is not ready.
 */
@Controller()
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(private readonly readiness: ReadinessService) {}

  @Get('/healthz')
  @HttpCode(200)
  healthz() {
    return { status: 'ok', uptimeMs: Date.now() - this.startedAt };
  }

  @Get('/readyz')
  readyz(@Res({ passthrough: true }) reply: FastifyReply) {
    const ready = this.readiness.isReady();
    reply.code(ready ? 200 : 503);
    return {
      ready,
      draining: this.readiness.isDraining(),
      components: this.readiness.details(),
    };
  }
}

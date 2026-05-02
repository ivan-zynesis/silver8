import { Global, Module } from '@nestjs/common';
import { READINESS_REPORTER } from '@silver8/core';
import { HealthController } from './health.controller.js';
import { MetricsController } from './metrics.controller.js';
import { StatusController } from './status.controller.js';
import { ReadinessService } from '../readiness/readiness.service.js';

/**
 * @Global so the READINESS_REPORTER token is available to subsystem modules
 * (ingestion, gateway-ws, mcp-server) without each having to re-import HttpModule.
 */
@Global()
@Module({
  controllers: [HealthController, MetricsController, StatusController],
  providers: [
    ReadinessService,
    { provide: READINESS_REPORTER, useExisting: ReadinessService },
  ],
  exports: [ReadinessService, READINESS_REPORTER],
})
export class HttpModule {}

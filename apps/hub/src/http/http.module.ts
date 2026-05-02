import { Global, Module } from '@nestjs/common';
import { DRAIN_REGISTRAR, READINESS_REPORTER } from '@silver8/core';
import { HealthController } from './health.controller.js';
import { McpController } from './mcp.controller.js';
import { MetricsController } from './metrics.controller.js';
import { StatusController } from './status.controller.js';
import { ReadinessService } from '../readiness/readiness.service.js';
import { ShutdownService } from '../shutdown/shutdown.service.js';

/**
 * @Global so the READINESS_REPORTER and DRAIN_REGISTRAR tokens are available to
 * subsystem modules (ingestion, gateway-ws, mcp-server) without re-importing.
 *
 * Also hosts the HTTP shell controllers (health, readiness, metrics, status, mcp).
 */
@Global()
@Module({
  controllers: [HealthController, MetricsController, StatusController, McpController],
  providers: [
    ReadinessService,
    ShutdownService,
    { provide: READINESS_REPORTER, useExisting: ReadinessService },
    { provide: DRAIN_REGISTRAR, useExisting: ShutdownService },
  ],
  exports: [
    ReadinessService,
    ShutdownService,
    READINESS_REPORTER,
    DRAIN_REGISTRAR,
  ],
})
export class HttpModule {}

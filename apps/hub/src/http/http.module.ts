import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { MetricsController } from './metrics.controller.js';
import { StatusController } from './status.controller.js';
import { ReadinessService } from '../readiness/readiness.service.js';

@Module({
  controllers: [HealthController, MetricsController, StatusController],
  providers: [ReadinessService],
  exports: [ReadinessService],
})
export class HttpModule {}

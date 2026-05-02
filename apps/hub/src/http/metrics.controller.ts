import { Controller, Get, Header, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { promRegistry } from '@silver8/observability';

@Controller()
export class MetricsController {
  @Get('/metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async metrics(@Res({ passthrough: true }) _reply: FastifyReply): Promise<string> {
    return await promRegistry.metrics();
  }
}

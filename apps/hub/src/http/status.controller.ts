import { Controller, Get, Inject } from '@nestjs/common';
import { REGISTRY, ORDER_BOOK_STORE, type Registry, type OrderBookStore } from '@silver8/core';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';

/**
 * /status — the engineer-facing JSON status surface (DEC-022).
 * The MCP `get_hub_status` tool (M4) returns the same payload via the same builder.
 */
@Controller()
export class StatusController {
  private readonly startedAt = Date.now();

  constructor(
    @Inject(REGISTRY) private readonly registry: Registry,
    @Inject(ORDER_BOOK_STORE) private readonly store: OrderBookStore,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get('/status')
  status() {
    return buildStatus(this.registry, this.store, this.env, this.startedAt);
  }
}

export interface HubStatus {
  service: string;
  mode: string;
  uptimeSeconds: number;
  topics: Array<{
    uri: string;
    consumerCount: number;
    stale: boolean;
    sequence: number | null;
    lastTimestamp: string | null;
  }>;
  consumers: { ws: number; mcp: number; totalSubscriptions: number };
  /** Populated from upstream telemetry in M2; placeholder shape until then. */
  upstream: Record<string, unknown>;
}

export function buildStatus(
  registry: Registry,
  store: OrderBookStore,
  env: Env,
  startedAtMs: number,
): HubStatus {
  const regStatus = registry.status();
  const topics = regStatus.byTopic.map((t) => {
    const tob = store.getTopOfBook(t.topic);
    return {
      uri: t.topic,
      consumerCount: t.consumerCount,
      stale: tob?.stale ?? false,
      sequence: tob?.sequence ?? null,
      lastTimestamp: tob?.timestamp ?? null,
    };
  });

  return {
    service: 'silver8-market-data-hub',
    mode: env.MODE,
    uptimeSeconds: Math.floor((Date.now() - startedAtMs) / 1000),
    topics,
    consumers: {
      ws: regStatus.consumersBySurface.ws,
      mcp: regStatus.consumersBySurface.mcp,
      totalSubscriptions: regStatus.totalSubscriptions,
    },
    upstream: {},
  };
}

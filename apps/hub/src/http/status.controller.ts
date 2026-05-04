import { Controller, Get, Inject, Optional } from '@nestjs/common';
import { REGISTRY, ORDER_BOOK_STORE, type Registry, type OrderBookStore } from '@silver8/core';
import { IngestionService } from '@silver8/ingestion';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';

/**
 * /status — the engineer-facing JSON status surface (DEC-022).
 * The MCP `get_hub_status` tool (M4) returns the same payload via the same builder.
 *
 * IngestionService is injected as Optional so this controller works in modes
 * where ingestion isn't loaded (future MODE=gateway).
 */
@Controller()
export class StatusController {
  private readonly startedAt = Date.now();

  constructor(
    @Inject(REGISTRY) private readonly registry: Registry,
    @Inject(ORDER_BOOK_STORE) private readonly store: OrderBookStore,
    @Inject(ENV) private readonly env: Env,
    @Optional() private readonly ingestion?: IngestionService,
  ) {}

  @Get('/status')
  status() {
    return buildStatus(this.registry, this.store, this.env, this.startedAt, this.ingestion);
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
  upstream: Record<string, unknown>;
}

export function buildStatus(
  registry: Registry,
  store: OrderBookStore,
  env: Env,
  startedAtMs: number,
  ingestion?: IngestionService,
): HubStatus {
  const regStatus = registry.status();

  // Surface every known topic, not just topics with consumers — operators want
  // visibility into whether upstream books are healthy regardless of demand.
  const consumersByTopic = new Map<string, number>(
    regStatus.byTopic.map((t) => [t.topic, t.consumerCount]),
  );
  const allUris = new Set<string>([
    ...regStatus.byTopic.map((t) => t.topic),
    ...store.knownTopics(),
  ]);

  const topics = Array.from(allUris).map((uri) => {
    const tob = store.getTopOfBook(uri as Parameters<OrderBookStore['getTopOfBook']>[0]);
    return {
      uri,
      consumerCount: consumersByTopic.get(uri) ?? 0,
      stale: tob?.stale ?? false,
      sequence: tob?.sequence ?? null,
      lastTimestamp: tob?.timestamp ?? null,
    };
  });

  const upstream: Record<string, unknown> = {};
  if (ingestion) {
    const s = ingestion.status();
    upstream.coinbase = {
      ...s.coinbase,
      booksKnown: s.topicsKnown.length,
      lifecycle: s.lifecycle,
    };
  }

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
    upstream,
  };
}

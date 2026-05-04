import { Controller, Get, Inject, Optional } from '@nestjs/common';
import {
  ORDER_BOOK_STORE,
  REGISTRY,
  VENUE_ADAPTER_CATALOG,
  type OrderBookStore,
  type Registry,
  type ResourceURI,
  type TopicDescriptor,
  type VenueAdapterCatalog,
} from '@silver8/core';
import { IngestionService } from '@silver8/ingestion';
import { McpServerService } from '@silver8/mcp-server';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';

/**
 * /status — the engineer-facing JSON status surface (DEC-022, DEC-032).
 * The MCP `get_hub_status` tool returns the same payload via a parity builder.
 *
 * IngestionService is injected as Optional so this controller works in modes
 * where ingestion isn't loaded (future MODE=gateway).
 *
 * `catalog` (DEC-030): what could be subscribed to — sourced from the venue
 * adapter's catalog, populated synchronously at startup.
 * `active`: what is currently warm — registry-subscribed topics plus topics
 * with state in the store.
 */
@Controller()
export class StatusController {
  private readonly startedAt = Date.now();

  constructor(
    @Inject(REGISTRY) private readonly registry: Registry,
    @Inject(ORDER_BOOK_STORE) private readonly store: OrderBookStore,
    @Inject(ENV) private readonly env: Env,
    @Inject(VENUE_ADAPTER_CATALOG) private readonly catalog: VenueAdapterCatalog,
    @Optional() private readonly ingestion?: IngestionService,
    @Optional() private readonly mcp?: McpServerService,
  ) {}

  @Get('/status')
  status() {
    return buildStatus(
      this.registry,
      this.store,
      this.catalog,
      this.env,
      this.startedAt,
      this.ingestion,
      this.mcp,
    );
  }
}

export interface HubStatus {
  service: string;
  mode: string;
  uptimeSeconds: number;
  /** Catalog of subscribable topics — what could a consumer ask for? (DEC-030) */
  catalog: TopicDescriptor[];
  /** Active topics — currently warm, with consumer/freshness info. */
  active: Array<{
    uri: string;
    consumerCount: number;
    stale: boolean;
    sequence: number | null;
    lastTimestamp: string | null;
  }>;
  consumers: { ws: number; mcp: number; totalSubscriptions: number };
  upstream: Record<string, unknown>;
  /** MCP transport + endpoint path so the dashboard can render a truthful onboarding snippet. */
  mcp?: { transport: 'http' | 'stdio'; path: string };
}

export function buildStatus(
  registry: Registry,
  store: OrderBookStore,
  catalog: VenueAdapterCatalog,
  env: Env,
  startedAtMs: number,
  ingestion?: IngestionService,
  mcp?: McpServerService,
): HubStatus {
  const regStatus = registry.status();

  const consumersByTopic = new Map<string, number>(
    regStatus.byTopic.map((t) => [t.topic, t.consumerCount]),
  );
  const activeUris = new Set<string>([
    ...regStatus.byTopic.map((t) => t.topic),
    ...store.knownTopics(),
  ]);

  const active = Array.from(activeUris).map((uri) => {
    const tob = store.getTopOfBook(uri as ResourceURI);
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
    catalog: [...catalog.listCatalog()],
    active,
    consumers: {
      ws: regStatus.consumersBySurface.ws,
      mcp: regStatus.consumersBySurface.mcp,
      totalSubscriptions: regStatus.totalSubscriptions,
    },
    upstream,
    ...(mcp ? { mcp: mcp.getMcpStatus() } : {}),
  };
}

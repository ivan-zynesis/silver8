import type {
  OrderBookStore,
  Registry,
  ResourceURI,
  TopicDescriptor,
  VenueAdapterCatalog,
} from '@silver8/core';

/**
 * Status payload shared between HTTP `/status` and MCP `get_hub_status`.
 * Defined here so both surfaces compile against the same shape (DEC-022, DEC-032).
 *
 * `catalog` answers "what could a consumer ask for?" (DEC-030); `active`
 * answers "what is currently warm?" The two diverge in the demand-driven
 * world (DEC-027) — a cold hub has populated catalog and empty active.
 */
export interface McpHubStatus {
  service: string;
  mode: string;
  uptimeSeconds: number;
  catalog: TopicDescriptor[];
  active: Array<{
    uri: string;
    consumerCount: number;
    stale: boolean;
    sequence: number | null;
    lastTimestamp: string | null;
  }>;
  consumers: { ws: number; mcp: number; totalSubscriptions: number };
  upstream: Record<string, unknown>;
}

export interface StatusBuilderOptions {
  service: string;
  mode: string;
  startedAtMs: number;
  upstream?: Record<string, unknown>;
}

export function buildMcpStatus(
  registry: Registry,
  store: OrderBookStore,
  catalog: VenueAdapterCatalog,
  opts: StatusBuilderOptions,
): McpHubStatus {
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

  return {
    service: opts.service,
    mode: opts.mode,
    uptimeSeconds: Math.floor((Date.now() - opts.startedAtMs) / 1000),
    catalog: [...catalog.listCatalog()],
    active,
    consumers: {
      ws: regStatus.consumersBySurface.ws,
      mcp: regStatus.consumersBySurface.mcp,
      totalSubscriptions: regStatus.totalSubscriptions,
    },
    upstream: opts.upstream ?? {},
  };
}

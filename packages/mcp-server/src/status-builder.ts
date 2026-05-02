import type { OrderBookStore, Registry, ResourceURI } from '@silver8/core';

/**
 * Status payload shared between HTTP `/status` and MCP `get_hub_status`.
 * Defined here so both surfaces compile against the same shape (DEC-022).
 *
 * The actual builder in apps/hub/http/status.controller.ts is the canonical one;
 * the MCP tool delegates to a structurally-equivalent builder (we keep the two
 * separate to avoid a backwards dependency from a package onto the app).
 */
export interface McpHubStatus {
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

export interface StatusBuilderOptions {
  service: string;
  mode: string;
  startedAtMs: number;
  upstream?: Record<string, unknown>;
}

export function buildMcpStatus(
  registry: Registry,
  store: OrderBookStore,
  opts: StatusBuilderOptions,
): McpHubStatus {
  const regStatus = registry.status();
  const consumersByTopic = new Map<string, number>(
    regStatus.byTopic.map((t) => [t.topic, t.consumerCount]),
  );
  const allUris = new Set<string>([
    ...regStatus.byTopic.map((t) => t.topic),
    ...store.knownTopics(),
  ]);

  const topics = Array.from(allUris).map((uri) => {
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
    topics,
    consumers: {
      ws: regStatus.consumersBySurface.ws,
      mcp: regStatus.consumersBySurface.mcp,
      totalSubscriptions: regStatus.totalSubscriptions,
    },
    upstream: opts.upstream ?? {},
  };
}

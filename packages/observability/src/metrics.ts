import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/**
 * Centralised Prometheus registry. Components import the gauges/counters they need
 * and update them on the relevant events. The /metrics endpoint serves this registry.
 *
 * Metric naming follows the prom-client convention:  hub_<area>_<thing>_<unit>.
 */
export const promRegistry = new Registry();
collectDefaultMetrics({ register: promRegistry });

export const activeConsumerConnections = new Gauge({
  name: 'hub_active_consumer_connections',
  help: 'Active consumer connections, partitioned by surface (ws | mcp).',
  labelNames: ['surface'],
  registers: [promRegistry],
});

export const activeSubscriptions = new Gauge({
  name: 'hub_active_subscriptions',
  help: 'Active downstream subscriptions across all consumers.',
  registers: [promRegistry],
});

export const upstreamMessages = new Counter({
  name: 'hub_upstream_messages_total',
  help: 'Total messages received from upstream venues.',
  labelNames: ['venue', 'kind'],
  registers: [promRegistry],
});

export const upstreamConnectionStatus = new Gauge({
  name: 'hub_upstream_connection_status',
  help: 'Upstream connection status (1=connected, 0=disconnected).',
  labelNames: ['venue'],
  registers: [promRegistry],
});

export const consumerDrops = new Counter({
  name: 'hub_consumer_drops_total',
  help: 'Messages dropped due to per-consumer queue overflow (DEC-011).',
  labelNames: ['surface', 'reason'],
  registers: [promRegistry],
});

export const consumerLaggedDisconnects = new Counter({
  name: 'hub_consumer_lagged_disconnects_total',
  help: 'Consumers disconnected for sustained-overflow lag (DEC-011).',
  labelNames: ['surface'],
  registers: [promRegistry],
});

export const sequenceGaps = new Counter({
  name: 'hub_sequence_gaps_total',
  help: 'L2 sequence gaps detected, triggering resync (DEC-010).',
  labelNames: ['venue', 'symbol'],
  registers: [promRegistry],
});

export const upstreamLatency = new Histogram({
  name: 'hub_upstream_message_latency_ms',
  help: 'Latency from upstream message timestamp to Bus publish, milliseconds.',
  labelNames: ['venue'],
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 5000],
  registers: [promRegistry],
});

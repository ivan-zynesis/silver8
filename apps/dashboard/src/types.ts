// Mirrors the hub's HTTP /status response shape (apps/hub/src/http/status.controller.ts).
// Kept manually in sync; a future enhancement could codegen from a shared schema.

export interface HubStatusTopic {
  uri: string;
  consumerCount: number;
  stale: boolean;
  sequence: number | null;
  lastTimestamp: string | null;
}

export interface HubStatus {
  service: string;
  mode: string;
  uptimeSeconds: number;
  topics: HubStatusTopic[];
  consumers: { ws: number; mcp: number; totalSubscriptions: number };
  upstream: {
    coinbase?: {
      status: 'connected' | 'connecting' | 'disconnected' | 'reconnecting';
      connectedAt?: string;
      symbols: string[];
      lastMessageAt?: string;
      reconnectAttempts: number;
      booksKnown: number;
    };
  } & Record<string, unknown>;
}

export interface BookLevel {
  price: number;
  size: number;
}

export interface BookView {
  venue: string;
  symbol: string;
  bids: BookLevel[];
  asks: BookLevel[];
  sequence: number;
  timestamp: string;
  stale: boolean;
  staleReason?: string;
}

// WS gateway server → client event shapes, mirroring packages/gateway-ws/src/protocol.ts.
export type ServerEvent =
  | { event: 'ack'; op: 'subscribe' | 'unsubscribe'; resource: string; id?: string }
  | { event: 'snapshot'; resource: string; data: BookView; sequence: number; stale: boolean }
  | { event: 'update'; resource: string; data: BookView; sequence: number }
  | { event: 'stale'; resource: string; reason: string }
  | { event: 'fresh'; resource: string }
  | { event: 'lagged'; resource: string; dropped: number }
  | { event: 'rebalance'; reason: string; deadlineMs: number }
  | { event: 'error'; code: string; message: string; id?: string }
  | { event: 'pong'; id?: string };

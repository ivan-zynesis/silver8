// Wire types for Coinbase Advanced Trade WebSocket API.
// Reference: https://docs.cloud.coinbase.com/advanced-trade-api/docs/ws-channels

export interface CoinbaseSubscribeMessage {
  type: 'subscribe' | 'unsubscribe';
  product_ids: string[];
  channel: 'level2' | 'heartbeats' | 'subscriptions';
}

export interface CoinbaseEnvelope {
  channel: string;
  client_id?: string;
  timestamp: string;
  sequence_num: number;
  events: unknown[];
}

export interface CoinbaseL2Update {
  side: 'bid' | 'offer';
  event_time: string;
  price_level: string;
  new_quantity: string;
}

export interface CoinbaseL2Event {
  type: 'snapshot' | 'update';
  product_id: string;
  updates: CoinbaseL2Update[];
}

export interface CoinbaseHeartbeatEvent {
  current_time: string;
  heartbeat_counter: number;
}

export interface CoinbaseSubscriptionEvent {
  subscriptions: Record<string, string[]>;
}

export type CoinbaseChannel = 'l2_data' | 'heartbeats' | 'subscriptions';

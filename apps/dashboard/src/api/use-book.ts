import { useEffect, useState } from 'react';
import type { BookView, ServerEvent } from '../types.js';
import { useGatewayConnection, type GatewayConnectionState } from './gateway-connection.js';

export type BookConnectionState = GatewayConnectionState;

interface UseBookResult {
  view: BookView | null;
  connection: BookConnectionState;
  /** Most recent server event other than snapshot/update — useful for surfacing stale/lagged/rebalance. */
  lastNotice: ServerEvent | null;
}

/**
 * Subscribe to a market topic via the shared dashboard WebSocket connection
 * (see GatewayConnectionProvider). Returns the latest BookView for `uri` and
 * the underlying connection state. The shared connection's refcount handles
 * dedup when multiple consumers ask for the same URI; closing the last
 * consumer triggers `unsubscribe` on the wire.
 */
export function useBookSubscription(uri: string | null): UseBookResult {
  const conn = useGatewayConnection();
  const [view, setView] = useState<BookView | null>(null);
  const [lastNotice, setLastNotice] = useState<ServerEvent | null>(null);

  useEffect(() => {
    if (!uri) {
      setView(null);
      setLastNotice(null);
      return;
    }

    setView(null);
    setLastNotice(null);

    const off = conn.subscribe(uri, (msg) => {
      switch (msg.event) {
        case 'snapshot':
        case 'update':
          setView(msg.data);
          break;
        case 'ack':
          break;
        case 'stale':
        case 'fresh':
        case 'lagged':
        case 'rebalance':
        case 'error':
          setLastNotice(msg);
          break;
        default:
          break;
      }
    });

    return off;
  }, [uri, conn]);

  return { view, connection: conn.state, lastNotice };
}

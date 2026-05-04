import { useEffect, useRef, useState } from 'react';
import type { BookView, ServerEvent } from '../types.js';

export type BookConnectionState =
  | { kind: 'idle' }
  | { kind: 'connecting' }
  | { kind: 'open' }
  | { kind: 'closed'; reason: string };

interface UseBookResult {
  view: BookView | null;
  connection: BookConnectionState;
  /** Most recent server event other than snapshot/update — useful for surfacing stale/lagged/rebalance. */
  lastNotice: ServerEvent | null;
}

/**
 * Open a WS connection to the gateway and subscribe to the given URI.
 * Emits the latest BookView (snapshot or update) and surface-level events.
 *
 * The WS gateway's port (default 3001) is separate from the HTTP port. We
 * derive the URL from the page's hostname so it works behind the dev proxy
 * and in production (when the hub serves the dashboard from the same host).
 */
export function useBookSubscription(uri: string | null, port = 3001): UseBookResult {
  const [view, setView] = useState<BookView | null>(null);
  const [connection, setConnection] = useState<BookConnectionState>({ kind: 'idle' });
  const [lastNotice, setLastNotice] = useState<ServerEvent | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!uri) {
      setView(null);
      setConnection({ kind: 'idle' });
      return;
    }

    const url = `ws://${window.location.hostname}:${port}/`;
    setConnection({ kind: 'connecting' });
    setView(null);

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnection({ kind: 'open' });
      ws.send(JSON.stringify({ op: 'subscribe', resource: uri }));
    };
    ws.onmessage = (ev) => {
      let msg: ServerEvent;
      try {
        msg = JSON.parse(ev.data) as ServerEvent;
      } catch {
        return;
      }
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
    };
    ws.onerror = () => {
      setConnection({ kind: 'closed', reason: 'error' });
    };
    ws.onclose = (e) => {
      setConnection({ kind: 'closed', reason: e.reason || `code ${e.code}` });
    };

    return () => {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ op: 'unsubscribe', resource: uri }));
        }
      } catch {
        // ignore
      }
      ws.close();
      wsRef.current = null;
    };
  }, [uri, port]);

  return { view, connection, lastNotice };
}

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { ServerEvent } from '../types.js';

/**
 * Shared WebSocket connection to the hub's gateway. One connection per
 * dashboard window — every tab/component shares it (DEC-026 data plane,
 * dashboard-validation-tools initiative).
 *
 * Refcounting per URI inside the provider matches the gateway's own
 * idempotent-subscribe behavior: when N UI tabs subscribe to the same URI,
 * the dashboard sends a single `subscribe` op; the underlying registry
 * sees one subscription. Closing one tab keeps the subscription alive for
 * the others; closing the last sends `unsubscribe`.
 *
 * Each browser tab/window opens its own provider instance — i.e. its own
 * WebSocket. That's intentional: opening multiple browser windows is the
 * walkthrough technique to demo refcount across consumers (DS-OPERATOR-USABILITY).
 */

export type GatewayConnectionState =
  | { kind: 'idle' }
  | { kind: 'connecting' }
  | { kind: 'open' }
  | { kind: 'closed'; reason: string };

export interface GatewayConnection {
  state: GatewayConnectionState;
  /**
   * Subscribe a listener to events for `uri`. Returns an unsubscribe
   * function. The first listener for a URI triggers the WS `subscribe` op;
   * the last listener leaving triggers `unsubscribe`.
   */
  subscribe(uri: string, listener: (ev: ServerEvent) => void): () => void;
}

/**
 * Pure refcount + dispatch logic, factored out of the React Provider so it
 * can be unit-tested without a DOM. `send(op, uri)` is invoked once per URI
 * transition (first listener → subscribe; last listener leaves → unsubscribe).
 */
export interface SubscriptionMux {
  subscribe(uri: string, listener: (ev: ServerEvent) => void): () => void;
  dispatch(uri: string | undefined, ev: ServerEvent): void;
  /** For tests / introspection: number of distinct URIs with at least one listener. */
  size(): number;
}

export function createSubscriptionMux(
  send: (op: 'subscribe' | 'unsubscribe', uri: string) => void,
): SubscriptionMux {
  const listeners = new Map<string, Set<(ev: ServerEvent) => void>>();
  return {
    subscribe(uri, listener) {
      let set = listeners.get(uri);
      const isFirst = !set || set.size === 0;
      if (!set) {
        set = new Set();
        listeners.set(uri, set);
      }
      set.add(listener);
      if (isFirst) send('subscribe', uri);

      return () => {
        const s = listeners.get(uri);
        if (!s) return;
        s.delete(listener);
        if (s.size === 0) {
          listeners.delete(uri);
          send('unsubscribe', uri);
        }
      };
    },
    dispatch(uri, ev) {
      if (uri) {
        const s = listeners.get(uri);
        if (s) for (const cb of s) cb(ev);
      } else {
        for (const s of listeners.values()) for (const cb of s) cb(ev);
      }
    },
    size() {
      return listeners.size;
    },
  };
}

const GatewayConnectionContext = createContext<GatewayConnection | null>(null);

interface ProviderProps {
  port?: number;
  children: ReactNode;
}

export function GatewayConnectionProvider({ port = 3001, children }: ProviderProps) {
  const [state, setState] = useState<GatewayConnectionState>({ kind: 'idle' });
  const wsRef = useRef<WebSocket | null>(null);
  // Pending subscribes/unsubscribes queued before the socket opens.
  const pendingOpsRef = useRef<Array<{ op: 'subscribe' | 'unsubscribe'; uri: string }>>([]);

  // Subscription mux is stable across renders; the `send` it captures dispatches
  // to wsRef.current (or queues if not yet open).
  const muxRef = useRef<SubscriptionMux | null>(null);
  if (!muxRef.current) {
    muxRef.current = createSubscriptionMux((op, uri) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ op, resource: uri }));
      } else {
        pendingOpsRef.current.push({ op, uri });
      }
    });
  }

  useEffect(() => {
    const url = `ws://${window.location.hostname}:${port}/`;
    setState({ kind: 'connecting' });

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setState({ kind: 'open' });
      for (const { op, uri } of pendingOpsRef.current) {
        ws.send(JSON.stringify({ op, resource: uri }));
      }
      pendingOpsRef.current = [];
    };

    ws.onmessage = (ev) => {
      let msg: ServerEvent;
      try {
        msg = JSON.parse(ev.data) as ServerEvent;
      } catch {
        return;
      }
      const resource = (msg as { resource?: string }).resource;
      muxRef.current?.dispatch(resource, msg);
    };

    ws.onerror = () => {
      setState({ kind: 'closed', reason: 'error' });
    };

    ws.onclose = (e) => {
      setState({ kind: 'closed', reason: e.reason || `code ${e.code}` });
    };

    return () => {
      try { ws.close(); } catch { /* ignore */ }
      wsRef.current = null;
      pendingOpsRef.current = [];
    };
  }, [port]);

  const value = useMemo<GatewayConnection>(() => ({
    get state() { return state; },
    subscribe: (uri, listener) => muxRef.current!.subscribe(uri, listener),
  }), [state]);

  return (
    <GatewayConnectionContext.Provider value={value}>
      {children}
    </GatewayConnectionContext.Provider>
  );
}

export function useGatewayConnection(): GatewayConnection {
  const ctx = useContext(GatewayConnectionContext);
  if (!ctx) {
    throw new Error('useGatewayConnection must be used within a GatewayConnectionProvider');
  }
  return ctx;
}

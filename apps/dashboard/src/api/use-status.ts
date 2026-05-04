import { useEffect, useRef, useState } from 'react';
import type { HubStatus } from '../types.js';

interface UseStatusResult {
  status: HubStatus | null;
  error: Error | null;
  loading: boolean;
}

/**
 * Polls /status at the configured cadence (default 1.5s). DEC-026 — telemetry
 * is slow-moving so polling is sufficient and bounded.
 */
export function useStatus(intervalMs = 1500): UseStatusResult {
  const [status, setStatus] = useState<HubStatus | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const aborter = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      aborter.current?.abort();
      aborter.current = new AbortController();
      try {
        const res = await fetch(statusUrl(), { signal: aborter.current.signal });
        if (!res.ok) throw new Error(`/status returned ${res.status}`);
        const data = (await res.json()) as HubStatus;
        if (cancelled) return;
        setStatus(data);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        if ((err as Error).name === 'AbortError') return;
        setError(err as Error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    tick();
    const id = window.setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      aborter.current?.abort();
    };
  }, [intervalMs]);

  return { status, error, loading };
}

function statusUrl(): string {
  // When served from the hub at /dashboard/*, /status is sibling. When running
  // via Vite dev server, the proxy forwards /status to the hub.
  return '/status';
}

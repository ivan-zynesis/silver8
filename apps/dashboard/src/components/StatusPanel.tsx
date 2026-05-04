import type { HubStatus } from '../types.js';

interface Props {
  status: HubStatus | null;
  loading: boolean;
  error: Error | null;
}

export function StatusPanel({ status, loading, error }: Props) {
  if (error) {
    return (
      <section className="panel panel--error">
        <h2>Hub Status</h2>
        <p className="error">{error.message}</p>
      </section>
    );
  }
  if (loading || !status) {
    return (
      <section className="panel">
        <h2>Hub Status</h2>
        <p className="muted">Loading…</p>
      </section>
    );
  }

  const upstream = status.upstream.coinbase;

  return (
    <section className="panel">
      <h2>Hub Status</h2>
      <div className="grid">
        <Cell label="Mode" value={<code>{status.mode}</code>} />
        <Cell label="Uptime" value={formatDuration(status.uptimeSeconds)} />
        <Cell
          label="Upstream (Coinbase)"
          value={
            upstream ? (
              <span className={`pill pill--${upstream.status}`}>{upstream.status}</span>
            ) : (
              <span className="muted">none</span>
            )
          }
        />
        <Cell
          label="Lifecycle"
          value={
            upstream ? <code>{upstream.lifecycle}</code> : <span className="muted">—</span>
          }
        />
        <Cell
          label="Subscribed channels"
          value={
            upstream
              ? upstream.subscribedChannels.length === 0
                ? <span className="muted">none</span>
                : <span className="mono">{upstream.subscribedChannels.join(', ')}</span>
              : '—'
          }
        />
        <Cell
          label="Books known"
          value={upstream ? `${upstream.booksKnown}` : '—'}
        />
        <Cell label="Consumers (WS)" value={`${status.consumers.ws}`} />
        <Cell label="Consumers (MCP)" value={`${status.consumers.mcp}`} />
        <Cell label="Active subscriptions" value={`${status.consumers.totalSubscriptions}`} />
        <Cell
          label="Reconnect attempts"
          value={upstream ? `${upstream.reconnectAttempts}` : '—'}
        />
      </div>

      <h3>Active topics</h3>
      {status.active.length === 0 ? (
        <p className="muted">
          No active topics — demand-driven mode awaits a consumer subscribe before
          opening upstream channels (DEC-027). The catalog below shows what's askable.
        </p>
      ) : (
        <table className="topics">
          <thead>
            <tr>
              <th>Resource</th>
              <th>Consumers</th>
              <th>Sequence</th>
              <th>Last update</th>
              <th>Stale</th>
            </tr>
          </thead>
          <tbody>
            {status.active.map((t) => (
              <tr key={t.uri} className={t.stale ? 'row--stale' : undefined}>
                <td><code>{t.uri}</code></td>
                <td>{t.consumerCount}</td>
                <td>{t.sequence ?? '—'}</td>
                <td>{t.lastTimestamp ? new Date(t.lastTimestamp).toLocaleTimeString() : '—'}</td>
                <td>{t.stale ? <span className="pill pill--stale">stale</span> : <span className="muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>Catalog</h3>
      {!status.catalog || status.catalog.length === 0 ? (
        <p className="muted">Catalog not yet populated.</p>
      ) : (
        <p className="catalog">
          {status.catalog.map((entry) => (
            <code key={entry.uri} className="catalog__entry">{entry.symbol}</code>
          ))}
        </p>
      )}
    </section>
  );
}

function Cell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="cell">
      <div className="cell__label">{label}</div>
      <div className="cell__value">{value}</div>
    </div>
  );
}

function formatDuration(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m < 60) return `${m}m ${sec}s`;
  const h = Math.floor(m / 60);
  const minRem = m % 60;
  return `${h}h ${minRem}m`;
}

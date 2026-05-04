import type { BookView, ServerEvent } from '../types.js';
import type { BookConnectionState } from '../api/use-book.js';

interface Props {
  symbol: string | null;
  view: BookView | null;
  connection: BookConnectionState;
  lastNotice: ServerEvent | null;
}

const DEPTH = 5;

export function BookTicker({ symbol, view, connection, lastNotice }: Props) {
  if (!symbol) {
    return (
      <section className="panel">
        <h2>Book ticker</h2>
        <p className="muted">Pick a symbol above to subscribe.</p>
      </section>
    );
  }

  const bestBid = view?.bids[0];
  const bestAsk = view?.asks[0];
  const mid = bestBid && bestAsk ? (bestBid.price + bestAsk.price) / 2 : null;
  const spread = bestBid && bestAsk ? bestAsk.price - bestBid.price : null;

  return (
    <section className="panel">
      <header className="panel__header">
        <h2>Book ticker — {symbol}</h2>
        <ConnectionBadge connection={connection} />
      </header>

      {view?.stale && (
        <div className="banner banner--stale">
          stale — {view.staleReason ?? 'upstream gap; resync in progress'}
        </div>
      )}
      {lastNotice && lastNotice.event !== 'ack' && (
        <NoticeRow notice={lastNotice} />
      )}

      <div className="grid grid--quote">
        <Cell label="Best bid" value={fmtPrice(bestBid?.price)} accent="bid" />
        <Cell label="Best ask" value={fmtPrice(bestAsk?.price)} accent="ask" />
        <Cell label="Mid" value={fmtPrice(mid)} />
        <Cell label="Spread" value={fmtSpread(spread)} />
        <Cell label="Sequence" value={view?.sequence != null ? String(view.sequence) : '—'} />
        <Cell
          label="Updated"
          value={view?.timestamp ? new Date(view.timestamp).toLocaleTimeString() : '—'}
        />
      </div>

      <div className="depth">
        <DepthSide title="Bids (descending)" levels={view?.bids ?? []} side="bid" />
        <DepthSide title="Asks (ascending)" levels={view?.asks ?? []} side="ask" />
      </div>
    </section>
  );
}

function ConnectionBadge({ connection }: { connection: BookConnectionState }) {
  switch (connection.kind) {
    case 'idle': return <span className="pill pill--muted">idle</span>;
    case 'connecting': return <span className="pill pill--connecting">connecting…</span>;
    case 'open': return <span className="pill pill--connected">connected</span>;
    case 'closed': return <span className="pill pill--disconnected" title={connection.reason}>closed</span>;
  }
}

function NoticeRow({ notice }: { notice: ServerEvent }) {
  let cls = 'banner';
  let text = '';
  switch (notice.event) {
    case 'stale':
      cls += ' banner--stale';
      text = `stale: ${notice.reason}`;
      break;
    case 'fresh':
      cls += ' banner--ok';
      text = 'fresh — recovered';
      break;
    case 'lagged':
      cls += ' banner--warn';
      text = `lagged — ${notice.dropped} message(s) dropped`;
      break;
    case 'rebalance':
      cls += ' banner--warn';
      text = `rebalance hint: ${notice.reason} (${notice.deadlineMs}ms)`;
      break;
    case 'error':
      cls += ' banner--error';
      text = `error: ${notice.code} — ${notice.message}`;
      break;
    default:
      return null;
  }
  return <div className={cls}>{text}</div>;
}

function DepthSide({
  title,
  levels,
  side,
}: {
  title: string;
  levels: { price: number; size: number }[];
  side: 'bid' | 'ask';
}) {
  const top = levels.slice(0, DEPTH);
  return (
    <div className={`depth__side depth__side--${side}`}>
      <h3>{title}</h3>
      <table>
        <thead>
          <tr>
            <th>Price</th>
            <th>Size</th>
          </tr>
        </thead>
        <tbody>
          {top.length === 0 ? (
            <tr><td colSpan={2} className="muted">—</td></tr>
          ) : (
            top.map((l) => (
              <tr key={l.price}>
                <td>{fmtPrice(l.price)}</td>
                <td>{l.size.toFixed(4)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function Cell({
  label,
  value,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  accent?: 'bid' | 'ask';
}) {
  return (
    <div className={`cell${accent ? ` cell--${accent}` : ''}`}>
      <div className="cell__label">{label}</div>
      <div className="cell__value">{value}</div>
    </div>
  );
}

function fmtPrice(p: number | null | undefined): string {
  if (p == null) return '—';
  return p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtSpread(s: number | null): string {
  if (s == null) return '—';
  return s.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

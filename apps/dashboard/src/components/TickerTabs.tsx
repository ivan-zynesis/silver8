import { useMemo, useState } from 'react';
import type { CatalogEntry } from '../types.js';
import { useBookSubscription } from '../api/use-book.js';
import { BookTicker } from './BookTicker.js';

interface Props {
  catalog: CatalogEntry[];
}

interface Tab {
  id: string;
  symbol: string;
}

let tabSeq = 0;
const newTabId = () => `tab-${++tabSeq}`;

function bookUri(symbol: string): string {
  return `market://coinbase/book/${symbol}`;
}

/**
 * Multi-tab BookTicker. Each tab is an independent UI subscription to a
 * symbol; the underlying GatewayConnection multiplexes them over one WS
 * (DEC-026 + dashboard-validation-tools). Closing the last tab on a symbol
 * triggers an upstream unsubscribe via the demand-driven lifecycle (DEC-027).
 */
export function TickerTabs({ catalog }: Props) {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pickerValue, setPickerValue] = useState<string>('');

  const symbols = useMemo(() => catalog.map((c) => c.symbol), [catalog]);

  const openTab = (symbol: string) => {
    if (!symbol) return;
    const tab: Tab = { id: newTabId(), symbol };
    setTabs((prev) => [...prev, tab]);
    setActiveId(tab.id);
    setPickerValue('');
  };

  const closeTab = (id: string) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (activeId === id) {
        setActiveId(next.length > 0 ? next[next.length - 1].id : null);
      }
      return next;
    });
  };

  return (
    <section className="panel">
      <header className="panel__header">
        <h2>Book tickers</h2>
        <span className="muted">
          one WS connection · {tabs.length} tab{tabs.length === 1 ? '' : 's'}
        </span>
      </header>

      <div className="tabs">
        {tabs.map((t) => (
          <div
            key={t.id}
            className={`tabs__chip${t.id === activeId ? ' tabs__chip--active' : ''}`}
            onClick={() => setActiveId(t.id)}
          >
            <span className="tabs__symbol">{t.symbol}</span>
            <button
              type="button"
              className="tabs__close"
              aria-label={`close ${t.symbol}`}
              onClick={(e) => { e.stopPropagation(); closeTab(t.id); }}
            >
              ×
            </button>
          </div>
        ))}

        <div className="tabs__add">
          <select
            value={pickerValue}
            onChange={(e) => {
              const sym = e.target.value;
              setPickerValue(sym);
              if (sym) openTab(sym);
            }}
          >
            <option value="">+ open tab…</option>
            {symbols.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      {tabs.length === 0 ? (
        <p className="muted">
          No tabs open. Pick a symbol from the catalog above to subscribe.
          Open multiple tabs to demonstrate one WS multiplexing many subscriptions
          (DEC-027 demand-driven channels open as the first tab subscribes).
        </p>
      ) : (
        <>
          {/* Render all tab subscriptions so they stay alive even when not visible — the
              point is to demonstrate concurrent subscriptions over one WS. Only the
              active tab's BookTicker is shown. */}
          {tabs.map((t) => (
            <TabSubscription
              key={t.id}
              symbol={t.symbol}
              isActive={t.id === activeId}
            />
          ))}
        </>
      )}
    </section>
  );
}

function TabSubscription({ symbol, isActive }: { symbol: string; isActive: boolean }) {
  const { view, connection, lastNotice } = useBookSubscription(bookUri(symbol));
  if (!isActive) return null;
  return (
    <BookTicker
      symbol={symbol}
      view={view}
      connection={connection}
      lastNotice={lastNotice}
    />
  );
}

import { useMemo, useState } from 'react';
import { useStatus } from './api/use-status.js';
import { useBookSubscription } from './api/use-book.js';
import { StatusPanel } from './components/StatusPanel.js';
import { SymbolPicker } from './components/SymbolPicker.js';
import { BookTicker } from './components/BookTicker.js';

function bookUri(symbol: string): string {
  return `market://coinbase/book/${symbol}`;
}

export function App() {
  const { status, loading, error } = useStatus(1500);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);

  const symbols = useMemo(() => {
    return status?.upstream.coinbase?.symbols ?? [];
  }, [status]);

  const bookSub = useBookSubscription(selectedSymbol ? bookUri(selectedSymbol) : null);

  return (
    <div className="app">
      <header className="app__header">
        <h1>Silver 8 Hub</h1>
        <span className="muted">market data hub · operator dashboard</span>
      </header>

      <main className="app__main">
        <StatusPanel status={status} loading={loading} error={error} />

        <section className="panel">
          <SymbolPicker
            symbols={symbols}
            selected={selectedSymbol}
            onChange={setSelectedSymbol}
          />
        </section>

        <BookTicker
          symbol={selectedSymbol}
          view={bookSub.view}
          connection={bookSub.connection}
          lastNotice={bookSub.lastNotice}
        />
      </main>

      <footer className="app__footer">
        <span className="muted">DEC-025 · DEC-026 · DS-OPERATOR-USABILITY</span>
      </footer>
    </div>
  );
}

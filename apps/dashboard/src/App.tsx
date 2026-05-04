import { useStatus } from './api/use-status.js';
import { StatusPanel } from './components/StatusPanel.js';
import { TickerTabs } from './components/TickerTabs.js';
import { McpOnboarding } from './components/McpOnboarding.js';

export function App() {
  const { status, loading, error } = useStatus(1500);
  const catalog = status?.catalog ?? [];

  return (
    <div className="app">
      <header className="app__header">
        <h1>Silver 8 Hub</h1>
        <span className="muted">market data hub · operator dashboard</span>
      </header>

      <main className="app__main">
        <StatusPanel status={status} loading={loading} error={error} />
        <TickerTabs catalog={catalog} />
        <McpOnboarding status={status} />
      </main>

      <footer className="app__footer">
        <span className="muted">
          DEC-025 · DEC-026 · DEC-030 · DS-OPERATOR-USABILITY
        </span>
      </footer>
    </div>
  );
}

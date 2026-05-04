import { useState } from 'react';
import type { HubStatus } from '../types.js';

interface Props {
  status: HubStatus | null;
}

/**
 * MCP onboarding panel — copy-paste config for connecting an agent
 * (Claude Desktop) to this hub. The active transport (per status.mcp) is the
 * headline copy-paste-ready snippet; the inactive transport is shown
 * informationally with the env-var instruction to switch.
 *
 * DS-OPERATOR-USABILITY: keep the snippet truthful. Don't display
 * connection info that isn't currently working.
 */
export function McpOnboarding({ status }: Props) {
  if (!status) {
    return (
      <section className="panel">
        <h2>Connect an agent (MCP)</h2>
        <p className="muted">Loading hub configuration…</p>
      </section>
    );
  }
  if (!status.mcp) {
    return (
      <section className="panel">
        <h2>Connect an agent (MCP)</h2>
        <p className="muted">
          MCP server not detected on this hub instance (e.g. running in a
          mode that doesn't host MCP). Run with <code>MODE=monolith</code>.
        </p>
      </section>
    );
  }

  const { transport, path } = status.mcp;
  const httpUrl = `http://${window.location.host}${path || '/mcp'}`;

  const httpSnippet = formatJson({
    mcpServers: {
      silver8: { url: httpUrl },
    },
  });

  const stdioSnippet = formatJson({
    mcpServers: {
      silver8: {
        command: 'node',
        args: ['/path/to/silver8/apps/hub/dist/main.js'],
        env: { MCP_TRANSPORT: 'stdio' },
      },
    },
  });

  return (
    <section className="panel">
      <header className="panel__header">
        <h2>Connect an agent (MCP)</h2>
        <span className="muted">
          paste into <code>claude_desktop_config.json</code>
        </span>
      </header>

      <p className="muted">
        DEC-014 ships both transports. This hub is currently exposing
        <strong> {transport === 'http' ? 'HTTP+SSE' : 'stdio'}</strong> — that's
        the copy-paste-ready snippet below. The other transport is shown for
        reference; switch by setting <code>MCP_TRANSPORT</code> and restarting
        the hub.
      </p>

      <Snippet
        title="HTTP+SSE"
        active={transport === 'http'}
        body={httpSnippet}
        instruction={
          transport === 'http'
            ? `Hub is exposing this transport at ${httpUrl}.`
            : `Set MCP_TRANSPORT=http (default) and restart to use this.`
        }
      />

      <Snippet
        title="stdio"
        active={transport === 'stdio'}
        body={stdioSnippet}
        instruction={
          transport === 'stdio'
            ? 'Hub is exposing this transport.'
            : 'Set MCP_TRANSPORT=stdio and restart to use this. The args path is illustrative — point to your local build.'
        }
      />
    </section>
  );
}

function Snippet({
  title,
  active,
  body,
  instruction,
}: {
  title: string;
  active: boolean;
  body: string;
  instruction: string;
}) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore — older browsers without clipboard API
    }
  };
  return (
    <div className={`snippet${active ? '' : ' snippet--inactive'}`}>
      <div className="snippet__header">
        <span className="snippet__title">{title}</span>
        <span className={`pill ${active ? 'pill--connected' : 'pill--muted'}`}>
          {active ? 'active' : 'alternative'}
        </span>
        <button type="button" className="copy-button" onClick={onCopy}>
          {copied ? 'copied!' : 'copy'}
        </button>
      </div>
      <pre className="snippet__body"><code>{body}</code></pre>
      <p className="snippet__instruction muted">{instruction}</p>
    </div>
  );
}

function formatJson(obj: unknown): string {
  return JSON.stringify(obj, null, 2);
}

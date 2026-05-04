import { useState } from 'react';
import type { HubStatus } from '../types.js';

interface Props {
  status: HubStatus | null;
}

/**
 * MCP onboarding panel — copy-paste config for connecting an agent
 * (Claude Desktop) to this hub.
 *
 * Claude Desktop's `claude_desktop_config.json` only accepts stdio
 * `command/args/env` server entries — it does NOT accept a bare HTTP URL.
 * To consume the hub's HTTP transport from Claude Desktop, you spawn a
 * stdio↔HTTP bridge (mcp-remote) via `command: npx, args: [-y, mcp-remote,
 * <url>]`. The direct URL form is for MCP Inspector or other programmatic
 * HTTP clients, not Claude Desktop.
 *
 * DS-OPERATOR-USABILITY: keep snippets truthful. Don't display
 * connection info that won't actually work.
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

  // Claude Desktop config — bridge form: spawn `mcp-remote` over stdio,
  // bridge to the hub's HTTP endpoint. Works whenever the hub has HTTP
  // transport active. This is the configuration to use if you want one hub
  // to serve both the dashboard and Claude Desktop.
  const claudeBridgeSnippet = formatJson({
    mcpServers: {
      silver8: {
        command: 'npx',
        args: ['-y', 'mcp-remote', httpUrl],
      },
    },
  });

  // Claude Desktop config — spawn-local form: Claude Desktop runs its own
  // hub via stdio. Independent process from the dashboard hub. Use this if
  // you don't want the bridge dependency or aren't running a separate hub.
  const claudeStdioSnippet = formatJson({
    mcpServers: {
      silver8: {
        command: 'node',
        args: ['/path/to/silver8/apps/hub/dist/main.js'],
        env: { MODE: 'monolith', MCP_TRANSPORT: 'stdio' },
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
        Claude Desktop's config file only accepts stdio entries (
        <code>command</code>/<code>args</code>/<code>env</code>). To use the
        hub's HTTP transport, Claude Desktop spawns the <code>mcp-remote</code>
        bridge — that's the snippet below. The direct HTTP URL is shown
        separately for MCP Inspector and other programmatic clients.
      </p>

      <Snippet
        title="Claude Desktop · bridge to running HTTP hub"
        active={transport === 'http'}
        body={claudeBridgeSnippet}
        instruction={
          transport === 'http'
            ? `Bridges Claude Desktop's stdio to ${httpUrl}. Claude Desktop spawns mcp-remote (npx); no extra install. Restart Claude Desktop after saving config.`
            : 'Hub is currently running with stdio transport — there is no HTTP endpoint to bridge. Set MCP_TRANSPORT=http to expose one.'
        }
      />

      <Snippet
        title="Claude Desktop · spawn local stdio hub"
        active={false}
        body={claudeStdioSnippet}
        instruction="Claude Desktop launches its own hub instance over stdio. Independent of the dashboard hub. Replace the path with your local checkout."
      />

      {transport === 'http' && (
        <div className="snippet__reference">
          <div className="snippet__title">Direct HTTP endpoint</div>
          <p className="muted">
            For MCP Inspector or any HTTP MCP client (not Claude Desktop): {' '}
            <code>{httpUrl}</code>
          </p>
        </div>
      )}
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
        {active && <span className="pill pill--connected">recommended</span>}
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

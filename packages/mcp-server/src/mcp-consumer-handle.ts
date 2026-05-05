import type {
  BusMessage,
  ConsumerEvent,
  ConsumerHandle,
  SendResult,
} from '@silver8/core';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

/**
 * ConsumerHandle for an MCP HTTP session (DEC-035).
 *
 * Models an MCP session as a Registry-tracked consumer, symmetric with the
 * gateway-ws's WsConsumerHandle. This makes the demand-driven upstream
 * lifecycle (DEC-027) and the /status.consumers.mcp accounting work the same
 * way for both surfaces — the Registry is the single source of truth for
 * "how many subscribers does each topic have."
 *
 * Bus events are forwarded as `notifications/resources/updated` over the
 * session's SSE stream. Per the MCP protocol, the client re-reads the
 * resource on each notification; we don't push the BookView body in the
 * notification itself — `resources/read` returns the current view.
 */
export class McpConsumerHandle implements ConsumerHandle {
  readonly surface = 'mcp' as const;
  readonly connectedAt: string;

  /**
   * Session id is assigned by the SDK when `initialize` runs through
   * `transport.handleRequest()` — AFTER the handle is constructed (the
   * server's subscribe handlers close over the handle, so we need it before
   * `server.connect(transport)`). Until then, `id` reads as `mcp:pending`.
   * The controller calls `attachSessionId(id)` from `onsessioninitialized`
   * just before `Registry.registerConsumer(handle)`, so the registered id is
   * the real one.
   */
  private _sessionId: string;
  private _server: McpServer | null = null;

  constructor(
    initialSessionId: string,
    private readonly transport: StreamableHTTPServerTransport,
  ) {
    this._sessionId = initialSessionId;
    this.connectedAt = new Date().toISOString();
  }

  get id(): string {
    return `mcp:${this._sessionId}`;
  }

  get sessionId(): string {
    return this._sessionId;
  }

  attachSessionId(sessionId: string): void {
    this._sessionId = sessionId;
  }

  /**
   * The per-session McpServer is created AFTER the handle (because the
   * server's subscribe handler closures capture the handle to call deliver).
   * Controller wires the back-reference here once the server exists.
   */
  attachServer(server: McpServer): void {
    this._server = server;
  }

  deliver(msg: BusMessage): SendResult {
    // Notification dispatch is async; the MCP SDK serialises it onto the
    // transport's outbound queue. We treat any failure (transport already
    // closed mid-flight) as "queued and forgotten" — the next reaper or
    // session-close will clean up.
    void this._server?.server
      .notification({
        method: 'notifications/resources/updated',
        params: { uri: msg.uri },
      })
      .catch(() => {
        // transport gone; cleanup happens via onclose
      });
    return { status: 'queued' };
  }

  sendEvent(event: ConsumerEvent): void {
    if (event.type === 'rebalance') {
      void this._server?.server
        .notification({
          method: 'notifications/silver8/rebalance',
          params: { reason: event.reason, deadlineMs: event.deadlineMs },
        })
        .catch(() => { /* transport gone */ });
      return;
    }
    // stale / fresh / lagged all carry a uri — coalesce into a
    // resources/updated notification so the client re-reads and observes
    // the new freshness state in the BookView payload.
    if ('uri' in event) {
      void this._server?.server
        .notification({
          method: 'notifications/resources/updated',
          params: { uri: event.uri },
        })
        .catch(() => { /* transport gone */ });
    }
  }

  disconnect(_reason: string): void {
    void this.transport.close().catch(() => { /* already closed */ });
  }
}

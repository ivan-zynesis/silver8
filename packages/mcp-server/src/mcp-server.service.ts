import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  BUS,
  DRAIN_REGISTRAR,
  LOGGER,
  ORDER_BOOK_STORE,
  READINESS_REPORTER,
  REGISTRY,
  VENUE_ADAPTER_CATALOG,
  parseResourceUri,
  type Bus,
  type BusMessage,
  type Drainable,
  type DrainableRegistrar,
  type OrderBookStore,
  type ReadinessReporter,
  type Registry,
  type ResourceURI,
  type Unsubscribe,
  type VenueAdapterCatalog,
} from '@silver8/core';
import {
  activeConsumerConnections,
  type Logger,
} from '@silver8/observability';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { MCP_SERVER_CONFIG, type McpServerConfig } from './config.js';
import { buildMcpStatus, type McpHubStatus } from './status-builder.js';
import {
  DescribeTopicSchema,
  bookSnapshotSchema,
  catalogSymbols,
  describeTopic,
  getBookSnapshot,
  getTopOfBook,
  listConfiguredTopics,
  topOfBookSchema,
  type ToolDeps,
} from './tools.js';

const READINESS_KEY = 'mcp-server';

/**
 * MCP server wiring.
 *
 * - Registers tools (DEC-015) and a per-symbol book resource (DEC-013).
 * - The McpServer instance is created at bootstrap. The tools/resources are
 *   bound once.
 * - Transports are bound separately (stdio is started here; HTTP is bound by
 *   external code mounting routes on Fastify and calling `attachHttpTransport`).
 * - Tracks resource subscriptions to emit `notifications/resources/updated`
 *   on bus events.
 * - Implements Drainable for SIGTERM rebalance hint.
 */
@Injectable()
export class McpServerService
  implements OnApplicationBootstrap, OnModuleDestroy, Drainable
{
  readonly drainName = 'mcp-server';

  readonly mcp: McpServer;
  private readonly startedAt = Date.now();
  private readonly subscribedUris = new Set<ResourceURI>();
  private readonly busSubs = new Map<ResourceURI, Unsubscribe>();
  private toolDeps!: ToolDeps;

  constructor(
    @Inject(MCP_SERVER_CONFIG) private readonly config: McpServerConfig,
    @Inject(BUS) private readonly bus: Bus,
    @Inject(REGISTRY) private readonly registry: Registry,
    @Inject(ORDER_BOOK_STORE) private readonly store: OrderBookStore,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(READINESS_REPORTER) private readonly readiness: ReadinessReporter,
    @Inject(DRAIN_REGISTRAR) private readonly drainRegistrar: DrainableRegistrar,
    @Inject(VENUE_ADAPTER_CATALOG) private readonly catalog: VenueAdapterCatalog,
  ) {
    this.mcp = new McpServer(
      { name: 'silver8-market-data-hub', version: '0.1.0' },
      {
        capabilities: {
          tools: {},
          resources: { subscribe: true, listChanged: false },
        },
      },
    );
  }

  async onApplicationBootstrap(): Promise<void> {
    this.readiness.declare(READINESS_KEY);
    this.drainRegistrar.register(this);
    this.toolDeps = {
      store: this.store,
      catalog: this.catalog,
    };

    // For stdio transport: register tools/resources on the singleton McpServer
    // and wire bus → resources/subscribe streaming. The singleton is
    // connect()'d once to the stdio transport and lives for the process
    // lifetime (one client, persistent connection).
    //
    // For HTTP transport: the singleton is unused. Each HTTP request gets its
    // own fresh McpServer via createPerRequestServer() because the SDK only
    // allows one transport per server, and stateless HTTP creates a new
    // transport per request.
    if (this.config.transport === 'stdio') {
      this.registerToolsOn(this.mcp);
      this.registerResourcesOn(this.mcp);
      this.wireResourceSubscriptions();
      await this.connectStdio();
    }

    this.readiness.set(READINESS_KEY, true);
    this.logger.info({ transport: this.config.transport }, 'mcp server ready');
  }

  /**
   * Build a fresh McpServer with all tools and resources registered.
   * Used by the HTTP controller for stateless per-request serving (DEC-014;
   * the SDK's "one transport per server" rule means we can't share the
   * singleton across HTTP requests). Resource-subscribe streaming via the
   * bus is intentionally NOT wired here — that requires a long-lived
   * transport and is only meaningful for stdio. HTTP clients that want
   * streaming should connect via the stdio bridge (mcp-remote) or use the
   * native WS gateway.
   */
  createPerRequestServer(): McpServer {
    const server = new McpServer(
      { name: 'silver8-market-data-hub', version: '0.1.0' },
      {
        capabilities: {
          tools: {},
          resources: { subscribe: false, listChanged: false },
        },
      },
    );
    this.registerToolsOn(server);
    this.registerResourcesOn(server);
    return server;
  }

  async onModuleDestroy(): Promise<void> {
    this.readiness.set(READINESS_KEY, false);
    for (const off of this.busSubs.values()) off();
    this.busSubs.clear();
    this.subscribedUris.clear();
    try {
      await this.mcp.close();
    } catch {
      // ignore
    }
  }

  // === Drainable ===

  async drain(deadlineMs: number): Promise<void> {
    this.readiness.set(READINESS_KEY, false);
    try {
      // Send a custom notification through the MCP server's underlying transport(s).
      // Clients can subscribe to this method id to receive rebalance hints (DEC-019).
      // In stateless HTTP transport mode there's typically no active transport at
      // drain time (each request opens and closes its own); the SDK throws "Not
      // connected" which we silently swallow.
      await this.mcp.server.notification({
        method: 'notifications/silver8/rebalance',
        params: { reason: 'shutdown', deadlineMs },
      });
    } catch (err) {
      const msg = (err as Error).message ?? '';
      if (!msg.includes('Not connected')) {
        this.logger.warn({ err }, 'failed to send mcp rebalance notification');
      }
    }
    // Give clients a brief window to drain on their own, then close.
    await new Promise((r) => setTimeout(r, Math.min(500, deadlineMs)));
  }

  // === Tools (DEC-015) ===

  private registerToolsOn(server: McpServer): void {
    const symbols = catalogSymbols(this.toolDeps);

    server.registerTool(
      'list_topics',
      {
        title: 'List available market data topics',
        description:
          'Returns every subscribable market data topic. Use this first to discover what data is available. ' +
          'Each topic has a URI of the form market://<venue>/book/<symbol>.',
        inputSchema: {},
      },
      async () => {
        const topics = listConfiguredTopics(this.toolDeps);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(topics, null, 2) }],
          structuredContent: { topics } as unknown as Record<string, unknown>,
        };
      },
    );

    server.registerTool(
      'describe_topic',
      {
        title: 'Describe a topic',
        description:
          "Returns the schema, update cadence, an example payload, and current freshness for a topic. " +
          'Use this when you have a URI from list_topics and want to know the shape of its data before subscribing or reading.',
        inputSchema: DescribeTopicSchema.shape,
      },
      async (args) => {
        const result = describeTopic(args as z.infer<typeof DescribeTopicSchema>, this.toolDeps);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      },
    );

    const tobSchema = topOfBookSchema(symbols);
    server.registerTool(
      'get_top_of_book',
      {
        title: 'Get top of book',
        description:
          'Returns the current best bid, best ask, mid price, and spread for a trading pair. ' +
          'The most common query for a quote-style snapshot. ' +
          'Tagged with a `stale` flag — if true, the upstream feed has gapped and a resync is in progress; ' +
          'values are the last known good snapshot.',
        inputSchema: tobSchema.shape,
      },
      async (args) => {
        const result = getTopOfBook(args as z.infer<typeof tobSchema>, this.toolDeps);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      },
    );

    const snapSchema = bookSnapshotSchema(symbols);
    server.registerTool(
      'get_book_snapshot',
      {
        title: 'Get order book snapshot',
        description:
          'Returns the top-N levels of the order book per side as a point-in-time snapshot. ' +
          'Use this when you need depth beyond the best bid/ask (use get_top_of_book if best bid/ask is enough).',
        inputSchema: snapSchema.shape,
      },
      async (args) => {
        const result = getBookSnapshot(args as z.infer<typeof snapSchema>, this.toolDeps);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      },
    );

    server.registerTool(
      'get_hub_status',
      {
        title: 'Get hub status',
        description:
          'Returns hub uptime, upstream connection state, configured topics with consumer counts and ' +
          'staleness flags, and per-surface consumer counts. ' +
          'Use this to diagnose whether the hub is healthy and whether your topic of interest has fresh data.',
        inputSchema: {},
      },
      async () => {
        const status = this.buildStatus();
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(status, null, 2) }],
          structuredContent: status as unknown as Record<string, unknown>,
        };
      },
    );
  }

  // === Resources (DEC-013) ===

  private registerResourcesOn(server: McpServer): void {
    for (const entry of this.catalog.listCatalog()) {
      const { uri, symbol } = entry;
      server.registerResource(
        `book-${symbol}`,
        uri,
        {
          title: `${symbol} order book`,
          description: `Live L2 order book (top-50) for ${symbol} on Coinbase. Subscribe to receive updates.`,
          mimeType: 'application/json',
        },
        async () => {
          const view = this.store.getView(uri, 50);
          if (!view) {
            return {
              contents: [
                {
                  uri,
                  mimeType: 'application/json',
                  text: JSON.stringify({
                    venue: 'coinbase', symbol, bids: [], asks: [],
                    sequence: 0, timestamp: new Date(0).toISOString(),
                    stale: true, staleReason: 'awaiting initial snapshot',
                  }),
                },
              ],
            };
          }
          return {
            contents: [
              { uri, mimeType: 'application/json', text: JSON.stringify(view) },
            ],
          };
        },
      );
    }
  }

  /**
   * Wire MCP `resources/subscribe` to the bus. The MCP SDK exposes subscribe
   * notifications via callbacks on McpServer.server; we hook into the underlying
   * Server's notification channel directly because the high-level API doesn't
   * expose a subscribe handler.
   */
  private wireResourceSubscriptions(): void {
    // Hook into subscribe notifications. The SDK's high-level McpServer doesn't
    // surface these directly, so we handle them via the underlying Server.
    const underlying = this.mcp.server;
    // Listen for client subscribe messages by overriding the subscribe handler.
    // The high-level API automatically responds; we add a side-effect that
    // tracks the URI and wires it to the bus.
    underlying.setNotificationHandler =
      underlying.setNotificationHandler ?? (() => {});

    // Track every URI the client has expressed interest in. The MCP SDK
    // automatically responds to resources/subscribe; we cooperate by emitting
    // notifications/resources/updated on each bus event for that URI.
    // We instrument by wrapping the SDK's transport sender — but the cleanest
    // path is to subscribe to the bus eagerly for every catalog topic.
    for (const entry of this.catalog.listCatalog()) {
      const { uri } = entry;
      const off = this.bus.subscribe(uri, async (msg: BusMessage) => {
        // Only emit a notification when the URI is currently subscribed.
        if (!this.subscribedUris.has(uri)) return;
        try {
          await underlying.notification({
            method: 'notifications/resources/updated',
            params: { uri },
          });
        } catch (err) {
          this.logger.warn({ err, uri, kind: msg.kind }, 'failed to emit resource update notification');
        }
      });
      this.busSubs.set(uri, off);
    }
  }

  /** Public API to mark a URI as subscribed (called by transport-level wiring). */
  markSubscribed(uri: ResourceURI): void {
    try {
      parseResourceUri(uri);
    } catch {
      return;
    }
    this.subscribedUris.add(uri);
    activeConsumerConnections.inc({ surface: 'mcp' });
  }

  markUnsubscribed(uri: ResourceURI): void {
    if (this.subscribedUris.delete(uri)) {
      activeConsumerConnections.dec({ surface: 'mcp' });
    }
  }

  // === Status ===

  buildStatus(extraUpstream?: Record<string, unknown>): McpHubStatus {
    return buildMcpStatus(this.registry, this.store, this.catalog, {
      service: 'silver8-market-data-hub',
      mode: 'monolith', // best-effort; the StatusController's payload is canonical
      startedAtMs: this.startedAt,
      ...(extraUpstream ? { upstream: extraUpstream } : {}),
      mcp: this.getMcpStatus(),
    });
  }

  /**
   * Public so the HTTP StatusController can include the same `mcp` block in
   * its payload, keeping HTTP `/status` and MCP `get_hub_status` at parity
   * (DEC-022).
   */
  getMcpStatus(): { transport: 'http' | 'stdio'; path: string; port?: number } {
    if (this.config.transport === 'http') {
      return {
        transport: 'http',
        path: this.config.httpPath,
        port: this.config.httpPort,
      };
    }
    return { transport: 'stdio', path: '' };
  }

  // === Stdio transport ===

  private async connectStdio(): Promise<void> {
    const { StdioServerTransport } = await import(
      '@modelcontextprotocol/sdk/server/stdio.js'
    );
    const transport = new StdioServerTransport();
    await this.mcp.connect(transport);
    this.logger.info('mcp server connected via stdio');
  }

  /** Returns the underlying SDK server for advanced operations. */
  underlying() {
    return this.mcp;
  }
}

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
  UnknownTopicError,
  VENUE_ADAPTER_CATALOG,
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
import { type Logger } from '@silver8/observability';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { MCP_SERVER_CONFIG, type McpServerConfig } from './config.js';
import { buildMcpStatus, type McpHubStatus } from './status-builder.js';
import type { McpConsumerHandle } from './mcp-consumer-handle.js';
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
 * Carries per-session bus subscription state. Stored on the McpServer instance
 * so the controller can clean up on session drop without keeping a parallel
 * map keyed by server reference.
 */
type SessionServer = McpServer & {
  __busOff?: Map<ResourceURI, Unsubscribe>;
};

/**
 * Hook a controller can pass to drain so it can iterate live sessions.
 */
export interface SessionRegistry {
  count(): number;
  forEach(cb: (handle: McpConsumerHandle) => void): void;
  closeAll(reason: string): void;
}

/**
 * MCP server wiring (DEC-013, DEC-014, DEC-035).
 *
 * Two transport paths:
 *  - **stdio**: the singleton `this.mcp` is the long-lived server, connected
 *    once at bootstrap. Tools + resources are registered on it. Resource
 *    subscription handlers are wired here too — one stdio client → one
 *    process lifetime → no session map needed.
 *  - **HTTP** (DEC-035): the singleton is unused. Each session gets its own
 *    `McpServer` via `createSessionServer(handle)`. The controller owns the
 *    session map; this service exposes the factory and the drain hook.
 */
@Injectable()
export class McpServerService
  implements OnApplicationBootstrap, OnModuleDestroy, Drainable
{
  readonly drainName = 'mcp-server';

  readonly mcp: McpServer;
  private readonly startedAt = Date.now();
  private toolDeps!: ToolDeps;

  /**
   * Set by the McpController during its bootstrap so drain can iterate
   * live HTTP sessions. Null when transport=stdio.
   */
  private sessionRegistry: SessionRegistry | null = null;

  constructor(
    @Inject(MCP_SERVER_CONFIG) readonly config: McpServerConfig,
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

    if (this.config.transport === 'stdio') {
      // Singleton path — one client, persistent connection.
      this.registerToolsOn(this.mcp);
      this.registerResourcesOn(this.mcp);
      this.wireStdioSubscriptions(this.mcp);
      await this.connectStdio();
    }

    this.readiness.set(READINESS_KEY, true);
    this.logger.info({ transport: this.config.transport }, 'mcp server ready');
  }

  /**
   * Build a fresh McpServer for an HTTP session (DEC-035). Registers tools +
   * resources via the existing helpers, then wires `resources/subscribe` and
   * `resources/unsubscribe` request handlers to go through the Registry +
   * Bus — exactly the path the WS gateway uses for its consumers (DEC-026
   * symmetry). Per-URI `Unsubscribe` callbacks are attached to the server
   * instance for cleanup at session-drop time.
   */
  createSessionServer(handle: McpConsumerHandle): SessionServer {
    const server = new McpServer(
      { name: 'silver8-market-data-hub', version: '0.1.0' },
      {
        capabilities: {
          tools: {},
          resources: { subscribe: true, listChanged: false },
        },
      },
    ) as SessionServer;

    this.registerToolsOn(server);
    this.registerResourcesOn(server);

    const busOff = new Map<ResourceURI, Unsubscribe>();
    server.__busOff = busOff;

    server.server.setRequestHandler(SubscribeRequestSchema, async (req) => {
      const uri = req.params.uri as ResourceURI;
      if (!this.catalog.describeCatalogEntry(uri)) {
        throw new UnknownTopicError(
          uri,
          this.catalog.listCatalog().map((t) => t.uri),
        );
      }
      if (busOff.has(uri)) {
        // Idempotent — the SDK may dedup itself, but guard explicitly.
        return {};
      }
      this.registry.subscribe(handle.id, uri);
      const off = this.bus.subscribe(uri, (msg: BusMessage) => {
        handle.deliver(msg);
      });
      busOff.set(uri, off);
      return {};
    });

    server.server.setRequestHandler(UnsubscribeRequestSchema, async (req) => {
      const uri = req.params.uri as ResourceURI;
      const off = busOff.get(uri);
      if (off) {
        off();
        busOff.delete(uri);
        this.registry.unsubscribe(handle.id, uri);
      }
      return {};
    });

    return server;
  }

  /**
   * Tear down per-session bus subscriptions. Called by the controller when a
   * session is dropped (transport close, idle reaper, or drain).
   */
  cleanupSessionServer(server: SessionServer): void {
    const busOff = server.__busOff;
    if (busOff) {
      for (const off of busOff.values()) off();
      busOff.clear();
    }
  }

  /** Controller registers itself here so drain can walk sessions. */
  setSessionRegistry(registry: SessionRegistry): void {
    this.sessionRegistry = registry;
  }

  async onModuleDestroy(): Promise<void> {
    this.readiness.set(READINESS_KEY, false);
    try {
      await this.mcp.close();
    } catch {
      // ignore
    }
  }

  // === Drainable ===

  async drain(deadlineMs: number): Promise<void> {
    this.readiness.set(READINESS_KEY, false);

    // stdio: one persistent transport — emit rebalance over the singleton.
    if (this.config.transport === 'stdio') {
      try {
        await this.mcp.server.notification({
          method: 'notifications/silver8/rebalance',
          params: { reason: 'shutdown', deadlineMs },
        });
      } catch (err) {
        const m = (err as Error).message ?? '';
        if (!m.includes('Not connected')) {
          this.logger.warn({ err }, 'failed to send mcp rebalance notification (stdio)');
        }
      }
      await new Promise((r) => setTimeout(r, Math.min(500, deadlineMs)));
      return;
    }

    // http: iterate sessions, fire rebalance, wait, force-close stragglers.
    const reg = this.sessionRegistry;
    if (!reg) {
      await new Promise((r) => setTimeout(r, Math.min(200, deadlineMs)));
      return;
    }
    reg.forEach((handle) => {
      handle.sendEvent({ type: 'rebalance', reason: 'shutdown', deadlineMs });
    });
    const start = Date.now();
    while (reg.count() > 0 && Date.now() - start < deadlineMs) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (reg.count() > 0) {
      this.logger.warn({ remaining: reg.count() }, 'mcp drain deadline reached; force-closing');
      reg.closeAll('drain_timeout');
    }
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
   * stdio path: wire bus events for ALL catalog URIs as
   * `notifications/resources/updated` on the singleton transport. The SDK's
   * built-in `resources/subscribe` handler tracks subscribed URIs internally;
   * we simply emit notifications on every bus event and the SDK delivers
   * them to the subscribed client.
   *
   * This is fine for stdio because there's exactly one persistent client.
   * For HTTP, the per-session `createSessionServer` wires bus subscriptions
   * lazily (only on `resources/subscribe`) and per-session, which is more
   * efficient and gives clean per-session cleanup.
   */
  private wireStdioSubscriptions(server: McpServer): void {
    for (const entry of this.catalog.listCatalog()) {
      const { uri } = entry;
      this.bus.subscribe(uri, async () => {
        try {
          await server.server.notification({
            method: 'notifications/resources/updated',
            params: { uri },
          });
        } catch {
          // transport gone or not connected; the next reconnect will resume
        }
      });
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

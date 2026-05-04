import { z } from 'zod';

const ENV_SCHEMA = z.object({
  /** Deployment variant (DEC-016). */
  MODE: z.enum(['monolith', 'ingestion', 'gateway']).default('monolith'),

  /** HTTP port: serves /healthz, /readyz, /metrics, /status, and the MCP HTTP+SSE endpoint. */
  HTTP_PORT: z.coerce.number().int().positive().default(3000),

  /** WebSocket gateway port (M3). */
  WS_PORT: z.coerce.number().int().positive().default(3001),

  /** MCP transport (DEC-014). */
  MCP_TRANSPORT: z.enum(['http', 'stdio']).default('http'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  LOG_PRETTY: z
    .union([z.string(), z.boolean()])
    .transform((v) => v === true || v === 'true' || v === '1')
    .default(false),

  COINBASE_WS_URL: z.string().url().default('wss://advanced-trade-ws.coinbase.com'),

  /**
   * Ingestion lifecycle (DEC-027).
   *  - `demand_driven` (default): upstream channels subscribe only when consumer
   *    demand exists; socket closes after INGESTION_SOCKET_IDLE_MS of zero-channel idle.
   *  - `eager`: legacy/demo behavior; pre-subscribe all configured symbols at boot.
   *    Useful when you want warm books without any consumer connected.
   */
  INGESTION_LIFECYCLE: z.enum(['demand_driven', 'eager']).default('demand_driven'),
  /** Idle window (ms) before closing the upstream WS socket when no channels are subscribed. */
  INGESTION_SOCKET_IDLE_MS: z.coerce.number().int().nonnegative().default(300_000),

  GATEWAY_QUEUE_DEPTH: z.coerce.number().int().positive().default(1000),
  GATEWAY_OVERFLOW_DISCONNECT_MS: z.coerce.number().int().positive().default(5000),
  GATEWAY_BUFFERED_WATERMARK_BYTES: z.coerce.number().int().positive().default(1024 * 1024),

  /** SIGTERM drain budget (DEC-019, DEC-020). */
  DRAIN_DEADLINE_MS: z.coerce.number().int().positive().default(30000),
});

export type Env = z.infer<typeof ENV_SCHEMA>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = ENV_SCHEMA.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

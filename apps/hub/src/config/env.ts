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

  COINBASE_WS_URL: z.string().url().default('wss://ws-feed.exchange.coinbase.com'),
  /** Comma-separated symbols, e.g. "BTC-USD,ETH-USD,SOL-USD". */
  COINBASE_SYMBOLS: z.string().default('BTC-USD,ETH-USD,SOL-USD'),

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

export function symbolsFromEnv(env: Env): string[] {
  return env.COINBASE_SYMBOLS.split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

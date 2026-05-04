import { readFileSync } from 'node:fs';
import { z } from 'zod';

/**
 * Coinbase Advanced Trade WS envelope, faithful to what the real venue emits.
 * Captures and synthetic baselines both serialise as one envelope per JSONL line.
 */
export const EnvelopeSchema = z.object({
  channel: z.string(),
  timestamp: z.string(),
  sequence_num: z.number(),
  events: z.array(z.unknown()),
});
export type Envelope = z.infer<typeof EnvelopeSchema>;

export interface L2Update {
  side: 'bid' | 'offer';
  event_time: string;
  price_level: string;
  new_quantity: string;
}

export interface L2Event {
  type: 'snapshot' | 'update';
  product_id: string;
  updates: L2Update[];
}

export interface HeartbeatEvent {
  current_time: string;
  heartbeat_counter: number;
}

/**
 * Load a JSONL fixture file. Empty lines are skipped; malformed lines throw
 * (we don't tolerate silent corruption — fixture problems are setup bugs).
 */
export function loadFixture(path: string): Envelope[] {
  const raw = readFileSync(path, 'utf8');
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  const envelopes: Envelope[] = [];
  for (const [i, line] of lines.entries()) {
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch (err) {
      throw new Error(`fixture parse error at line ${i + 1}: ${(err as Error).message}`);
    }
    const result = EnvelopeSchema.safeParse(json);
    if (!result.success) {
      throw new Error(`fixture validation error at line ${i + 1}: ${result.error.message}`);
    }
    envelopes.push(result.data);
  }
  return envelopes;
}

/** Convenience: extract the product_id of an l2_data event, if any. */
export function l2EventProductId(event: unknown): string | null {
  if (typeof event !== 'object' || event === null) return null;
  const product_id = (event as { product_id?: unknown }).product_id;
  return typeof product_id === 'string' ? product_id : null;
}

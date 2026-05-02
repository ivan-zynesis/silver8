import { z } from 'zod';
import type { BookView } from '@silver8/core';

// Resource URI shape — kept loose at the protocol layer; the registry / parser
// validates the actual structure.
const ResourceUriSchema = z
  .string()
  .min(1)
  .refine((s) => s.startsWith('market://'), {
    message: 'expected market://<venue>/<kind>/<symbol> URI',
  });

// === Client → server ops (DEC-012) ===

export const SubscribeOpSchema = z.object({
  op: z.literal('subscribe'),
  resource: ResourceUriSchema,
  /** Optional client-side correlation id; echoed in the ack event. */
  id: z.string().optional(),
});

export const UnsubscribeOpSchema = z.object({
  op: z.literal('unsubscribe'),
  resource: ResourceUriSchema,
  id: z.string().optional(),
});

export const PingOpSchema = z.object({
  op: z.literal('ping'),
  id: z.string().optional(),
});

export const ClientOpSchema = z.discriminatedUnion('op', [
  SubscribeOpSchema,
  UnsubscribeOpSchema,
  PingOpSchema,
]);

export type SubscribeOp = z.infer<typeof SubscribeOpSchema>;
export type UnsubscribeOp = z.infer<typeof UnsubscribeOpSchema>;
export type PingOp = z.infer<typeof PingOpSchema>;
export type ClientOp = z.infer<typeof ClientOpSchema>;

// === Server → client events (DEC-012) ===

export type ServerEvent =
  | AckEvent
  | SnapshotEvent
  | UpdateEvent
  | StaleEvent
  | FreshEvent
  | LaggedEvent
  | RebalanceEvent
  | ErrorEvent
  | PongEvent;

export interface AckEvent {
  event: 'ack';
  op: 'subscribe' | 'unsubscribe';
  resource: string;
  id?: string;
}

export interface SnapshotEvent {
  event: 'snapshot';
  resource: string;
  data: BookView;
  sequence: number;
  stale: boolean;
}

export interface UpdateEvent {
  event: 'update';
  resource: string;
  data: BookView;
  sequence: number;
}

export interface StaleEvent {
  event: 'stale';
  resource: string;
  reason: string;
}

export interface FreshEvent {
  event: 'fresh';
  resource: string;
}

export interface LaggedEvent {
  event: 'lagged';
  resource: string;
  dropped: number;
}

export interface RebalanceEvent {
  event: 'rebalance';
  reason: string;
  deadlineMs: number;
}

export interface ErrorEvent {
  event: 'error';
  code: string;
  message: string;
  /** Echoes the client's correlation id when applicable. */
  id?: string;
}

export interface PongEvent {
  event: 'pong';
  id?: string;
}

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export function parseClientOp(raw: string): ParseResult<ClientOp> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    return { ok: false, error: `invalid JSON: ${(err as Error).message}` };
  }
  const result = ClientOpSchema.safeParse(json);
  if (!result.success) {
    const issue = result.error.issues[0];
    return {
      ok: false,
      error: `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    };
  }
  return { ok: true, value: result.data };
}

export function serializeEvent(ev: ServerEvent): string {
  return JSON.stringify(ev);
}

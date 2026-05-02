import { z } from 'zod';
import {
  buildResourceUri,
  parseResourceUri,
  type OrderBookStore,
  type ResourceURI,
  type Venue,
} from '@silver8/core';

/**
 * Tool schemas + handlers (DEC-015).
 *
 * Schemas use Zod with description() for every field. The MCP SDK derives the
 * JSON Schema sent to the LLM client from these — descriptions are LLM-facing
 * and load-bearing for the eval (DS-LLM-USABILITY).
 */

const VENUE_SCHEMA = z
  .enum(['coinbase'])
  .describe('Trading venue. Only "coinbase" is supported in v1.')
  .default('coinbase');

export interface ToolDeps {
  store: OrderBookStore;
  configuredSymbols: string[];
}

export interface TopicDescriptor {
  uri: ResourceURI;
  kind: 'book';
  venue: Venue;
  symbol: string;
  description: string;
}

export function listConfiguredTopics(deps: ToolDeps): TopicDescriptor[] {
  return deps.configuredSymbols.map((symbol) => ({
    uri: buildResourceUri('coinbase', 'book', symbol),
    kind: 'book',
    venue: 'coinbase',
    symbol,
    description: `Top-of-book and depth-N L2 order book for ${symbol} on Coinbase. Updates on every level change.`,
  }));
}

// --- describe_topic ---

export const DescribeTopicSchema = z.object({
  uri: z
    .string()
    .describe(
      'The topic URI to describe. Format: market://<venue>/book/<symbol> ' +
        '(e.g. market://coinbase/book/BTC-USD). Get the list of valid URIs with list_topics.',
    ),
});

export interface DescribeTopicResult {
  uri: ResourceURI;
  kind: 'book';
  venue: Venue;
  symbol: string;
  schema: string;
  cadence: string;
  examplePayload: object;
  freshness: { stale: boolean; sequence: number | null; lastTimestamp: string | null };
}

export function describeTopic(args: z.infer<typeof DescribeTopicSchema>, deps: ToolDeps): DescribeTopicResult {
  const parsed = parseResourceUri(args.uri);
  if (!deps.configuredSymbols.includes(parsed.symbol)) {
    throw new Error(
      `unknown symbol ${parsed.symbol}; available symbols: ${deps.configuredSymbols.join(', ')}`,
    );
  }
  const uri = args.uri as ResourceURI;
  const tob = deps.store.getTopOfBook(uri);
  return {
    uri,
    kind: 'book',
    venue: parsed.venue,
    symbol: parsed.symbol,
    schema:
      'BookView { venue, symbol, bids: [{price, size}…desc], asks: [{price, size}…asc], sequence, timestamp, stale, staleReason? }',
    cadence: 'Updates emitted on every level change; for active markets this is multiple times per second.',
    examplePayload: {
      venue: parsed.venue,
      symbol: parsed.symbol,
      bids: [{ price: 50000.0, size: 1.5 }, { price: 49999.5, size: 0.7 }],
      asks: [{ price: 50001.0, size: 0.5 }, { price: 50001.5, size: 2.1 }],
      sequence: 12345,
      timestamp: '2026-05-02T12:34:56.789Z',
      stale: false,
    },
    freshness: {
      stale: tob?.stale ?? false,
      sequence: tob?.sequence ?? null,
      lastTimestamp: tob?.timestamp ?? null,
    },
  };
}

// --- get_top_of_book ---

export function topOfBookSchema(symbols: string[]) {
  return z.object({
    symbol: z
      .string()
      .describe(`Trading pair symbol. Available: ${symbols.join(', ')}.`)
      .refine((s) => symbols.includes(s), {
        message: `unknown symbol; available: ${symbols.join(', ')}`,
      }),
    venue: VENUE_SCHEMA,
  });
}

export function getTopOfBook(
  args: { symbol: string; venue: Venue },
  deps: ToolDeps,
) {
  const uri = buildResourceUri(args.venue, 'book', args.symbol);
  const tob = deps.store.getTopOfBook(uri);
  if (!tob) {
    throw new Error(
      `no book state yet for ${args.symbol}; the upstream feed has not delivered a snapshot. ` +
        `Try get_hub_status to inspect upstream connection state.`,
    );
  }
  return tob;
}

// --- get_book_snapshot ---

export function bookSnapshotSchema(symbols: string[]) {
  return z.object({
    symbol: z
      .string()
      .describe(`Trading pair symbol. Available: ${symbols.join(', ')}.`)
      .refine((s) => symbols.includes(s), {
        message: `unknown symbol; available: ${symbols.join(', ')}`,
      }),
    venue: VENUE_SCHEMA,
    depth: z
      .number()
      .int()
      .min(1)
      .max(50)
      .describe('Top-N levels per side. Default 10. Max 50.')
      .default(10),
  });
}

export function getBookSnapshot(
  args: { symbol: string; venue: Venue; depth: number },
  deps: ToolDeps,
) {
  const uri = buildResourceUri(args.venue, 'book', args.symbol);
  const view = deps.store.getView(uri, args.depth);
  if (!view) {
    throw new Error(
      `no book state yet for ${args.symbol}; the upstream feed has not delivered a snapshot. ` +
        `Try get_hub_status to inspect upstream connection state.`,
    );
  }
  return view;
}
